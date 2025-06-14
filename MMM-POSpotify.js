/* MMM-POSpotify.js
 * 
 * A modern, minimalist Spotify module for MagicMirror²
 * 
 * By: Robin Frank
 * MIT Licensed.
 */

Module.register("MMM-POSpotify", {
    defaults: {
        updateInterval: 1000,           // Update every second
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
            this.file("styles/MMM-POSpotify.css"),
            "font-awesome.css"
        ];
    },

    // Required scripts
    getScripts: function() {
        return [
            this.file("scripts/color-extractor.js")
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
        const interval = this.config.lowPowerMode ? 
            this.config.updateInterval * 3 : 
            this.config.updateInterval;
            
        setInterval(() => {
            this.sendSocketNotification("GET_CURRENT_SONG");
        }, interval);
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
        this.updateDom(this.config.animationSpeed);
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
        
        if (this.config.fadeWhenInactive) {
            this.startInactivityTimer();
        } else {
            this.currentSong = null;
            this.updateDom(this.config.animationSpeed);
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

    // DOM generation
    getDom: function() {
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
        
        // Show current song or empty state
        if (this.currentSong && this.isPlaying) {
            switch(this.config.displayType) {
                case "minimalist":
                    return this.createMinimalistDisplay(wrapper);
                case "detailed":
                    return this.createDetailedDisplay(wrapper);
                case "compact":
                    return this.createCompactDisplay(wrapper);
                case "coverOnly":
                    return this.createCoverOnlyDisplay(wrapper);
                default:
                    return this.createMinimalistDisplay(wrapper);
            }
        } else {
            return this.createEmptyState(wrapper);
        }
    },

    // Create minimalist display
    createMinimalistDisplay: function(wrapper) {
        // Album art
        if (this.config.showAlbumArt && this.currentSong.albumArt) {
            const artContainer = document.createElement("div");
            artContainer.className = "album-art-container";
            
            const albumArt = document.createElement("img");
            albumArt.className = "album-art";
            albumArt.src = this.currentSong.albumArt;
            albumArt.style.width = this.config.albumArtSize + "px";
            albumArt.style.height = this.config.albumArtSize + "px";
            
            artContainer.appendChild(albumArt);
            wrapper.appendChild(artContainer);
        }
        
        // Info container
        const infoContainer = document.createElement("div");
        infoContainer.className = "info-container";
        
        // Title
        const title = document.createElement("div");
        title.className = "song-title";
        title.textContent = this.truncateText(this.currentSong.title, this.config.maxTitleLength);
        if (this.config.scrollLongText && this.currentSong.title.length > this.config.maxTitleLength) {
            title.classList.add("scrolling");
        }
        infoContainer.appendChild(title);
        
        // Artist
        const artist = document.createElement("div");
        artist.className = "song-artist";
        artist.textContent = this.truncateText(this.currentSong.artist, this.config.maxArtistLength);
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
            progress.style.width = `${(this.currentSong.progress / this.currentSong.duration) * 100}%`;
            
            progressBar.appendChild(progress);
            progressContainer.appendChild(progressBar);
            infoContainer.appendChild(progressContainer);
        }
        
        wrapper.appendChild(infoContainer);
        
        // Device icon
        if (this.config.showDeviceIcon && this.currentSong.device) {
            const deviceIcon = this.createDeviceIcon(this.currentSong.device.type);
            wrapper.appendChild(deviceIcon);
        }
        
        return wrapper;
    },

    // Create detailed display
    createDetailedDisplay: function(wrapper) {
        // Similar to minimalist but with more info
        const display = this.createMinimalistDisplay(wrapper);
        
        // Add album info
        const albumInfo = document.createElement("div");
        albumInfo.className = "album-info";
        albumInfo.textContent = this.currentSong.album;
        
        const infoContainer = display.querySelector(".info-container");
        infoContainer.insertBefore(albumInfo, infoContainer.querySelector(".progress-container"));
        
        // Add time info
        if (this.config.showProgressBar) {
            const timeInfo = document.createElement("div");
            timeInfo.className = "time-info";
            
            const currentTime = this.formatTime(this.currentSong.progress);
            const totalTime = this.formatTime(this.currentSong.duration);
            
            timeInfo.textContent = `${currentTime} / ${totalTime}`;
            infoContainer.appendChild(timeInfo);
        }
        
        // Add playback controls if enabled
        if (this.config.showPlaybackControls) {
            const controls = this.createPlaybackControls();
            display.appendChild(controls);
        }
        
        return display;
    },

    // Create compact display
    createCompactDisplay: function(wrapper) {
        wrapper.classList.add("horizontal-layout");
        
        // Small album art
        if (this.config.showAlbumArt && this.currentSong.albumArt) {
            const albumArt = document.createElement("img");
            albumArt.className = "album-art-small";
            albumArt.src = this.currentSong.albumArt;
            wrapper.appendChild(albumArt);
        }
        
        // Compact info
        const info = document.createElement("div");
        info.className = "compact-info";
        
        const songInfo = document.createElement("div");
        songInfo.className = "compact-song-info";
        songInfo.textContent = `${this.currentSong.title} • ${this.currentSong.artist}`;
        
        info.appendChild(songInfo);
        
        if (this.config.showProgressBar) {
            const progress = document.createElement("div");
            progress.className = "compact-progress";
            progress.style.width = `${(this.currentSong.progress / this.currentSong.duration) * 100}%`;
            info.appendChild(progress);
        }
        
        wrapper.appendChild(info);
        
        return wrapper;
    },

    // Create cover only display
    createCoverOnlyDisplay: function(wrapper) {
        if (this.currentSong.albumArt) {
            const albumArt = document.createElement("img");
            albumArt.className = "album-art-full";
            albumArt.src = this.currentSong.albumArt;
            wrapper.appendChild(albumArt);
            
            // Overlay info
            const overlay = document.createElement("div");
            overlay.className = "cover-overlay";
            
            const title = document.createElement("div");
            title.className = "overlay-title";
            title.textContent = this.currentSong.title;
            
            const artist = document.createElement("div");
            artist.className = "overlay-artist";
            artist.textContent = this.currentSong.artist;
            
            overlay.appendChild(title);
            overlay.appendChild(artist);
            wrapper.appendChild(overlay);
        }
        
        return wrapper;
    },

    // Create empty state
    createEmptyState: function(wrapper) {
        wrapper.classList.add("empty-state");
        
        if (this.config.showSpotifyLogo) {
            const logo = document.createElement("i");
            logo.className = "fab fa-spotify spotify-logo";
            logo.style.fontSize = this.config.logoSize + "px";
            wrapper.appendChild(logo);
        }
        
        const message = document.createElement("div");
        message.className = "empty-message";
        message.textContent = "Not playing";
        wrapper.appendChild(message);
        
        return wrapper;
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

    // Create device icon
    createDeviceIcon: function(deviceType) {
        const icon = document.createElement("i");
        icon.className = "device-icon fas ";
        
        switch(deviceType.toLowerCase()) {
            case "computer":
                icon.className += "fa-desktop";
                break;
            case "smartphone":
                icon.className += "fa-mobile-alt";
                break;
            case "speaker":
                icon.className += "fa-volume-up";
                break;
            case "tv":
                icon.className += "fa-tv";
                break;
            default:
                icon.className += "fa-music";
        }
        
        return icon;
    },

    // Create playback controls
    createPlaybackControls: function() {
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
        playPauseBtn.innerHTML = this.isPlaying ? 
            '<i class="fas fa-pause"></i>' : 
            '<i class="fas fa-play"></i>';
        playPauseBtn.addEventListener("click", () => {
            this.sendSocketNotification(this.isPlaying ? "PAUSE" : "PLAY");
        });
        
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
    }
});