/* MMM-POSpotify.js
 *
 * A modern, minimalist Spotify module for MagicMirror²
 * Fixed version with smooth progress bar and static DOM
 *
 * By: rxf-sys
 * MIT Licensed.
 */

Module.register("MMM-POSpotify", {
    defaults: {
        updateInterval: 5000,           // API update every 5 seconds
        animationSpeed: 500,            // Fade animation speed
        displayType: "minimalist",      // minimalist, detailed, compact, coverOnly

        // Authentication
        clientID: "",
        clientSecret: "",
        accessToken: "",
        refreshToken: "",

        // Display options
        showAlbumArt: true,
        albumArtSize: 200,              // Size in pixels
        showProgressBar: true,
        progressBarHeight: 3,           // Height in pixels
        showDeviceIcon: true,
        showSpotifyLogo: true,
        logoSize: 30,                   // Logo size in pixels

        // Theming
        theme: "dark",                  // dark, light, auto, glass
        accentColor: "#1DB954",         // Spotify green default
        useAlbumColors: false,          // Extract colors from album art
        backgroundBlur: true,           // Blur background behind module

        // Text options
        showArtistFirst: false,         // Show artist before song title
        maxTitleLength: 30,             // Max characters before truncation
        maxArtistLength: 25,
        scrollLongText: true,           // Scroll long text
        fontSize: "medium",             // small, medium, large

        // Advanced features
        showPlaybackControls: false,    // Show play/pause/skip buttons
        enableNotifications: true,      // Send notifications to other modules
        enableGestures: false,          // Touch/gesture support
        showLyrics: false,              // Integration with lyrics modules
        showVisualization: false,       // Audio visualization
        fadeWhenInactive: true,         // Fade out when not playing
        inactivityTimeout: 30000,       // Time before fading (ms)

        // Performance
        lowPowerMode: false,            // Reduce update frequency
        cacheAlbumArt: true,           // Cache album covers
        preloadNextTrack: false,       // Preload next track info
    },

    // Required styles
    getStyles: function() {
        return [
            this.file("MMM-POSpotify.css"),
            "font-awesome.css"
        ];
    },

    // Required scripts
    getScripts: function() {
        return [
            this.file("color-extractor.js")
        ];
    },

    // Start module
    start: function() {
        Log.info("Starting module: " + this.name);

        this.currentSong = null;
        this.previousSong = null;
        this.isPlaying = false;
        this.lastUpdateTime = 0;
        this.inactivityTimer = null;
        this.albumColors = null;
        this.spotifyApi = null;

        // Progress tracking
        this.progressInterval = null;
        this.lastProgressUpdate = 0;
        this.currentProgress = 0;
        this.currentDuration = 0;

        // DOM elements cache
        this.domCreated = false;
        this.elements = {};

        // Validate config
        if (!this.config.clientID || !this.config.clientSecret) {
            Log.error("MMM-POSpotify: Missing Spotify credentials!");
            this.showError("Missing Spotify credentials");
            return;
        }

        // Initialize module
        this.sendSocketNotification("INIT", {
            clientID: this.config.clientID,
            clientSecret: this.config.clientSecret,
            accessToken: this.config.accessToken,
            refreshToken: this.config.refreshToken
        });

        // Start update cycle
        this.scheduleUpdate();

        // Apply theme
        this.applyTheme();
    },

    // Schedule updates
    scheduleUpdate: function() {
        const interval = this.config.updateInterval;

        setInterval(() => {
            this.sendSocketNotification("GET_CURRENT_SONG");
        }, interval);

        // Initial request
        this.sendSocketNotification("GET_CURRENT_SONG");
    },

    // Socket notifications from node_helper
    socketNotificationReceived: function(notification, payload) {
        switch(notification) {
            case "SONG_DATA":
                this.processSongData(payload);
                break;

            case "PLAYER_STOPPED":
                this.handlePlayerStopped();
                break;

            case "AUTH_ERROR":
                this.showError("Authentication failed");
                break;

            case "API_ERROR":
                Log.error("Spotify API Error:", payload);
                break;

            case "TOKEN_REFRESHED":
                Log.info("Spotify token refreshed successfully");
                break;
        }
    },

    // Process song data
    processSongData: function(data) {
        if (!data || !data.item) {
            this.handlePlayerStopped();
            return;
        }

        this.previousSong = this.currentSong;
        this.currentSong = {
            title: data.item.name,
            artist: data.item.artists.map(a => a.name).join(", "),
            album: data.item.album.name,
            albumArt: this.getAlbumArt(data.item.album.images),
            progress: data.progress_ms,
            duration: data.item.duration_ms,
            isPlaying: data.is_playing,
            device: data.device ? {
                name: data.device.name,
                type: data.device.type
            } : null,
            id: data.item.id,
            uri: data.item.uri
        };

        this.isPlaying = data.is_playing;

        // Update progress tracking
        this.currentProgress = data.progress_ms;
        this.currentDuration = data.item.duration_ms;
        this.lastProgressUpdate = Date.now();

        // Extract album colors if enabled
        if (this.config.useAlbumColors && this.currentSong.albumArt) {
            this.extractAlbumColors(this.currentSong.albumArt);
        }

        // Send notifications if enabled
        if (this.config.enableNotifications) {
            this.sendNotification("SPOTIFY_UPDATE", this.currentSong);
        }

        // Reset inactivity timer
        this.resetInactivityTimer();

        // Update display
        if (!this.domCreated) {
            this.updateDom(this.config.animationSpeed);
        } else {
            this.updateContent();
        }

        // Start or restart progress animation
        this.startProgressAnimation();
    },

    // Start smooth progress animation
    startProgressAnimation: function() {
        // Clear existing interval
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }

        if (!this.isPlaying || !this.config.showProgressBar) {
            return;
        }

        // Update progress every 100ms for smooth animation
        this.progressInterval = setInterval(() => {
            if (this.isPlaying && this.currentDuration > 0) {
                const elapsed = Date.now() - this.lastProgressUpdate;
                this.currentProgress = Math.min(
                    this.currentProgress + elapsed,
                    this.currentDuration
                );
                this.lastProgressUpdate = Date.now();

                // Update progress bar
                this.updateProgressBar();
            }
        }, 100);
    },

    // Update only the progress bar
    updateProgressBar: function() {
        if (this.elements.progress && this.currentDuration > 0) {
            const percentage = (this.currentProgress / this.currentDuration) * 100;
            this.elements.progress.style.width = `${percentage}%`;
        }

        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = this.formatTime(this.currentProgress);
        }

        if (this.elements.totalTime) {
            this.elements.totalTime.textContent = this.formatTime(this.currentDuration);
        }
    },

    // Update content without recreating DOM
    updateContent: function() {
        if (!this.currentSong || !this.domCreated) return;

        // Update album art
        if (this.elements.albumArt && this.currentSong.albumArt) {
            if (this.elements.albumArt.src !== this.currentSong.albumArt) {
                this.elements.albumArt.src = this.currentSong.albumArt;
            }
        }

        // Update title
        if (this.elements.title) {
            const titleText = this.truncateText(this.currentSong.title, this.config.maxTitleLength);
            if (this.elements.title.textContent !== titleText) {
                this.elements.title.textContent = titleText;

                // Update scrolling class
                if (this.config.scrollLongText && this.currentSong.title.length > this.config.maxTitleLength) {
                    this.elements.title.classList.add("scrolling");
                } else {
                    this.elements.title.classList.remove("scrolling");
                }
            }
        }

        // Update artist
        if (this.elements.artist) {
            const artistText = this.truncateText(this.currentSong.artist, this.config.maxArtistLength);
            if (this.elements.artist.textContent !== artistText) {
                this.elements.artist.textContent = artistText;
            }
        }

        // Update album
        if (this.elements.album) {
            this.elements.album.textContent = this.currentSong.album;
        }

        // Update device icon
        if (this.elements.deviceIcon && this.currentSong.device) {
            const iconClass = this.getDeviceIconClass(this.currentSong.device.type);
            this.elements.deviceIcon.className = `device-icon fas ${iconClass}`;
        }

        // Update playback controls
        if (this.elements.playPauseBtn) {
            this.elements.playPauseBtn.innerHTML = this.isPlaying ?
                '<i class="fas fa-pause"></i>' :
                '<i class="fas fa-play"></i>';
        }

        // Show/hide empty state
        if (this.elements.wrapper) {
            if (this.isPlaying) {
                this.elements.wrapper.classList.remove("empty-state");
                if (this.elements.emptyState) {
                    this.elements.emptyState.style.display = "none";
                }
                if (this.elements.content) {
                    this.elements.content.style.display = "";
                }
            }
        }
    },

    // Get appropriate album art size
    getAlbumArt: function(images) {
        if (!images || images.length === 0) return null;

        // Find closest size to configured size
        const targetSize = this.config.albumArtSize;
        let closest = images[0];

        for (let img of images) {
            if (Math.abs(img.width - targetSize) < Math.abs(closest.width - targetSize)) {
                closest = img;
            }
        }

        return closest.url;
    },

    // Handle stopped player
    handlePlayerStopped: function() {
        this.isPlaying = false;

        // Stop progress animation
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }

        if (this.config.fadeWhenInactive) {
            this.startInactivityTimer();
        } else {
            if (this.domCreated && this.elements.content) {
                this.elements.content.style.display = "none";
                if (this.elements.emptyState) {
                    this.elements.emptyState.style.display = "";
                }
            } else {
                this.currentSong = null;
                this.updateDom(this.config.animationSpeed);
            }
        }
    },

    // Inactivity timer management
    resetInactivityTimer: function() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }

        // Remove inactive class
        const wrapper = document.getElementById(this.identifier);
        if (wrapper) {
            wrapper.classList.remove("inactive");
        }
    },

    startInactivityTimer: function() {
        this.resetInactivityTimer();

        this.inactivityTimer = setTimeout(() => {
            const wrapper = document.getElementById(this.identifier);
            if (wrapper) {
                wrapper.classList.add("inactive");
            }
        }, this.config.inactivityTimeout);
    },

    // Extract colors from album art
    extractAlbumColors: function(imageUrl) {
        if (typeof ColorExtractor !== 'undefined') {
            ColorExtractor.extract(imageUrl, (colors) => {
                this.albumColors = colors;
                this.applyAlbumColors();
            });
        }
    },

    // Apply extracted album colors
    applyAlbumColors: function() {
        if (!this.albumColors) return;

        const wrapper = document.getElementById(this.identifier);
        if (wrapper) {
            wrapper.style.setProperty('--spotify-accent', this.albumColors.primary);
            wrapper.style.setProperty('--spotify-secondary', this.albumColors.secondary);
            wrapper.style.setProperty('--spotify-background', this.albumColors.background);
        }
    },

    // Apply theme
    applyTheme: function() {
        const wrapper = document.getElementById(this.identifier);
        if (!wrapper) return;

        // Remove all theme classes
        wrapper.classList.remove('theme-dark', 'theme-light', 'theme-glass', 'theme-auto');

        // Add new theme class
        wrapper.classList.add(`theme-${this.config.theme}`);

        // Set custom accent color
        if (!this.config.useAlbumColors) {
            wrapper.style.setProperty('--spotify-accent', this.config.accentColor);
        }

        // Set font size
        wrapper.classList.add(`font-${this.config.fontSize}`);
    },

    // DOM generation - only called once or when structure changes
    getDom: function() {
        // If DOM already created and no error, return existing wrapper
        if (this.domCreated && !this.error) {
            return document.getElementById(this.identifier) || this.createDOM();
        }

        return this.createDOM();
    },

    // Create the DOM structure once
    createDOM: function() {
        const wrapper = document.createElement("div");
        wrapper.id = this.identifier;
        wrapper.className = `spotify-wrapper display-${this.config.displayType}`;

        if (this.config.backgroundBlur) {
            wrapper.classList.add("blur-background");
        }

        // Show error if any
        if (this.error) {
            return this.createErrorDisplay(wrapper);
        }

        // Create structure based on display type
        switch(this.config.displayType) {
            case "minimalist":
                this.createMinimalistStructure(wrapper);
                break;
            case "detailed":
                this.createDetailedStructure(wrapper);
                break;
            case "compact":
                this.createCompactStructure(wrapper);
                break;
            case "coverOnly":
                this.createCoverOnlyStructure(wrapper);
                break;
            default:
                this.createMinimalistStructure(wrapper);
        }

        // Mark DOM as created
        this.domCreated = true;

        // Initial content update
        if (this.currentSong && this.isPlaying) {
            this.updateContent();
            this.startProgressAnimation();
        } else {
            // Hide content, show empty state
            if (this.elements.content) {
                this.elements.content.style.display = "none";
            }
        }

        return wrapper;
    },

    // Create minimalist display structure
    createMinimalistStructure: function(wrapper) {
        // Content container
        const content = document.createElement("div");
        content.className = "content-container";
        this.elements.content = content;

        // Album art
        if (this.config.showAlbumArt) {
            const artContainer = document.createElement("div");
            artContainer.className = "album-art-container";

            const albumArt = document.createElement("img");
            albumArt.className = "album-art";
            albumArt.style.width = this.config.albumArtSize + "px";
            albumArt.style.height = this.config.albumArtSize + "px";
            this.elements.albumArt = albumArt;

            artContainer.appendChild(albumArt);
            content.appendChild(artContainer);
        }

        // Info container
        const infoContainer = document.createElement("div");
        infoContainer.className = "info-container";

        // Title
        const title = document.createElement("div");
        title.className = "song-title";
        this.elements.title = title;
        infoContainer.appendChild(title);

        // Artist
        const artist = document.createElement("div");
        artist.className = "song-artist";
        this.elements.artist = artist;
        infoContainer.appendChild(artist);

        // Progress bar
        if (this.config.showProgressBar) {
            const progressContainer = document.createElement("div");
            progressContainer.className = "progress-container";

            const progressBar = document.createElement("div");
            progressBar.className = "progress-bar";
            progressBar.style.height = this.config.progressBarHeight + "px";

            const progress = document.createElement("div");
            progress.className = "progress";
            this.elements.progress = progress;

            progressBar.appendChild(progress);
            progressContainer.appendChild(progressBar);
            infoContainer.appendChild(progressContainer);
        }

        content.appendChild(infoContainer);

        // Device icon
        if (this.config.showDeviceIcon) {
            const deviceIcon = document.createElement("i");
            deviceIcon.className = "device-icon fas";
            this.elements.deviceIcon = deviceIcon;
            content.appendChild(deviceIcon);
        }

        wrapper.appendChild(content);

        // Empty state
        this.createEmptyState(wrapper);

        // Store wrapper reference
        this.elements.wrapper = wrapper;
    },

    // Create detailed display structure
    createDetailedStructure: function(wrapper) {
        // Content container
        const content = document.createElement("div");
        content.className = "content-container detailed-content";
        this.elements.content = content;

        // Album art
        if (this.config.showAlbumArt) {
            const albumArt = document.createElement("img");
            albumArt.className = "album-art";
            this.elements.albumArt = albumArt;
            content.appendChild(albumArt);
        }

        // Info container
        const infoContainer = document.createElement("div");
        infoContainer.className = "info-container";

        // Title
        const title = document.createElement("div");
        title.className = "song-title";
        this.elements.title = title;
        infoContainer.appendChild(title);

        // Artist
        const artist = document.createElement("div");
        artist.className = "song-artist";
        this.elements.artist = artist;
        infoContainer.appendChild(artist);

        // Album
        const album = document.createElement("div");
        album.className = "album-info";
        this.elements.album = album;
        infoContainer.appendChild(album);

        // Progress bar
        if (this.config.showProgressBar) {
            const progressContainer = document.createElement("div");
            progressContainer.className = "progress-container";

            const progressBar = document.createElement("div");
            progressBar.className = "progress-bar";
            progressBar.style.height = this.config.progressBarHeight + "px";

            const progress = document.createElement("div");
            progress.className = "progress";
            this.elements.progress = progress;

            progressBar.appendChild(progress);
            progressContainer.appendChild(progressBar);
            infoContainer.appendChild(progressContainer);

            // Time info
            const timeInfo = document.createElement("div");
            timeInfo.className = "time-info";

            const currentTime = document.createElement("span");
            currentTime.className = "current-time";
            this.elements.currentTime = currentTime;

            const separator = document.createElement("span");
            separator.textContent = " / ";

            const totalTime = document.createElement("span");
            totalTime.className = "total-time";
            this.elements.totalTime = totalTime;

            timeInfo.appendChild(currentTime);
            timeInfo.appendChild(separator);
            timeInfo.appendChild(totalTime);
            infoContainer.appendChild(timeInfo);
        }

        content.appendChild(infoContainer);

        // Playback controls
        if (this.config.showPlaybackControls) {
            const controls = this.createPlaybackControlsStructure();
            content.appendChild(controls);
        }

        wrapper.appendChild(content);

        // Empty state
        this.createEmptyState(wrapper);

        // Store wrapper reference
        this.elements.wrapper = wrapper;
    },

    // Create compact display structure
    createCompactStructure: function(wrapper) {
        wrapper.classList.add("horizontal-layout");

        // Content container
        const content = document.createElement("div");
        content.className = "content-container compact-content";
        this.elements.content = content;

        // Small album art
        if (this.config.showAlbumArt) {
            const albumArt = document.createElement("img");
            albumArt.className = "album-art-small";
            this.elements.albumArt = albumArt;
            content.appendChild(albumArt);
        }

        // Compact info
        const info = document.createElement("div");
        info.className = "compact-info";

        const songInfo = document.createElement("div");
        songInfo.className = "compact-song-info";
        this.elements.songInfo = songInfo;
        info.appendChild(songInfo);

        if (this.config.showProgressBar) {
            const progress = document.createElement("div");
            progress.className = "compact-progress";
            this.elements.progress = progress;
            info.appendChild(progress);
        }

        content.appendChild(info);
        wrapper.appendChild(content);

        // Empty state
        this.createEmptyState(wrapper);

        // Store wrapper reference
        this.elements.wrapper = wrapper;
    },

    // Create cover only display structure
    createCoverOnlyStructure: function(wrapper) {
        // Content container
        const content = document.createElement("div");
        content.className = "content-container cover-content";
        this.elements.content = content;

        const albumArt = document.createElement("img");
        albumArt.className = "album-art-full";
        this.elements.albumArt = albumArt;
        content.appendChild(albumArt);

        // Overlay info
        const overlay = document.createElement("div");
        overlay.className = "cover-overlay";

        const title = document.createElement("div");
        title.className = "overlay-title";
        this.elements.title = title;

        const artist = document.createElement("div");
        artist.className = "overlay-artist";
        this.elements.artist = artist;

        overlay.appendChild(title);
        overlay.appendChild(artist);
        content.appendChild(overlay);

        wrapper.appendChild(content);

        // Empty state
        this.createEmptyState(wrapper);

        // Store wrapper reference
        this.elements.wrapper = wrapper;
    },

    // Create empty state
    createEmptyState: function(wrapper) {
        const emptyState = document.createElement("div");
        emptyState.className = "empty-state-container";
        emptyState.style.display = "none";

        if (this.config.showSpotifyLogo) {
            const logo = document.createElement("i");
            logo.className = "fab fa-spotify spotify-logo";
            logo.style.fontSize = this.config.logoSize + "px";
            emptyState.appendChild(logo);
        }

        const message = document.createElement("div");
        message.className = "empty-message";
        message.textContent = "Not playing";
        emptyState.appendChild(message);

        this.elements.emptyState = emptyState;
        wrapper.appendChild(emptyState);
    },

    // Create error display
    createErrorDisplay: function(wrapper) {
        wrapper.classList.add("error-state");

        const icon = document.createElement("i");
        icon.className = "fas fa-exclamation-triangle error-icon";
        wrapper.appendChild(icon);

        const message = document.createElement("div");
        message.className = "error-message";
        message.textContent = this.error;
        wrapper.appendChild(message);

        return wrapper;
    },

    // Get device icon class
    getDeviceIconClass: function(deviceType) {
        switch(deviceType.toLowerCase()) {
            case "computer":
                return "fa-desktop";
            case "smartphone":
                return "fa-mobile-alt";
            case "speaker":
                return "fa-volume-up";
            case "tv":
                return "fa-tv";
            default:
                return "fa-music";
        }
    },

    // Create playback controls structure
    createPlaybackControlsStructure: function() {
        const controls = document.createElement("div");
        controls.className = "playback-controls";

        const prevBtn = document.createElement("button");
        prevBtn.className = "control-btn";
        prevBtn.innerHTML = '<i class="fas fa-step-backward"></i>';
        prevBtn.addEventListener("click", () => {
            this.sendSocketNotification("PREVIOUS_TRACK");
        });

        const playPauseBtn = document.createElement("button");
        playPauseBtn.className = "control-btn play-pause";
        playPauseBtn.addEventListener("click", () => {
            this.sendSocketNotification(this.isPlaying ? "PAUSE" : "PLAY");
        });
        this.elements.playPauseBtn = playPauseBtn;

        const nextBtn = document.createElement("button");
        nextBtn.className = "control-btn";
        nextBtn.innerHTML = '<i class="fas fa-step-forward"></i>';
        nextBtn.addEventListener("click", () => {
            this.sendSocketNotification("NEXT_TRACK");
        });

        controls.appendChild(prevBtn);
        controls.appendChild(playPauseBtn);
        controls.appendChild(nextBtn);

        return controls;
    },

    // Update compact display info
    updateCompactInfo: function() {
        if (this.elements.songInfo && this.currentSong) {
            this.elements.songInfo.textContent =
                `${this.currentSong.title} • ${this.currentSong.artist}`;
        }
    },

    // Helper functions
    truncateText: function(text, maxLength) {
        if (!text) return "";
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    },

    formatTime: function(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    },

    showError: function(message) {
        this.error = message;
        this.domCreated = false; // Force DOM recreation for error
        this.updateDom();
    },

    // Notification handling
    notificationReceived: function(notification, payload, sender) {
        switch(notification) {
            case "SPOTIFY_PLAY":
                this.sendSocketNotification("PLAY");
                break;

            case "SPOTIFY_PAUSE":
                this.sendSocketNotification("PAUSE");
                break;

            case "SPOTIFY_NEXT":
                this.sendSocketNotification("NEXT_TRACK");
                break;

            case "SPOTIFY_PREVIOUS":
                this.sendSocketNotification("PREVIOUS_TRACK");
                break;

            case "SPOTIFY_VOLUME_UP":
            case "SPOTIFY_VOLUME_DOWN":
                this.sendSocketNotification(notification, payload);
                break;
        }
    },

    // Clean up when module is hidden
    suspend: function() {
        // Stop progress animation when module is hidden
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    },

    // Resume when module is shown again
    resume: function() {
        // Restart progress animation if playing
        if (this.isPlaying) {
            this.startProgressAnimation();
        }
    }
});
