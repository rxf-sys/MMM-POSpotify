/* node_helper.js
 * 
 * Node helper for MMM-POSpotify
 * Handles Spotify Web API communication
 */

const NodeHelper = require("node_helper");
const SpotifyWebApi = require("spotify-web-api-node");
const express = require("express");
const querystring = require("querystring");
const path = require("path");
const fs = require("fs");

module.exports = NodeHelper.create({
    // Start function
    start: function() {
        console.log("Starting node helper for: " + this.name);
        
        this.spotifyApi = null;
        this.tokenExpirationTime = 0;
        this.config = null;
        this.authorizationInProgress = false;
        
        // Start authorization server
        this.startAuthServer();
    },
    
    // Socket notification received
    socketNotificationReceived: function(notification, payload) {
        switch(notification) {
            case "INIT":
                this.initializeSpotify(payload);
                break;
                
            case "GET_CURRENT_SONG":
                this.getCurrentlyPlaying();
                break;
                
            case "PLAY":
                this.controlPlayback("play");
                break;
                
            case "PAUSE":
                this.controlPlayback("pause");
                break;
                
            case "NEXT_TRACK":
                this.controlPlayback("next");
                break;
                
            case "PREVIOUS_TRACK":
                this.controlPlayback("previous");
                break;
                
            case "SPOTIFY_VOLUME_UP":
            case "SPOTIFY_VOLUME_DOWN":
                this.controlVolume(notification, payload);
                break;
        }
    },
    
    // Initialize Spotify API
    initializeSpotify: function(config) {
        this.config = config;
        
        // Create Spotify API instance
        this.spotifyApi = new SpotifyWebApi({
            clientId: config.clientID,
            clientSecret: config.clientSecret,
            redirectUri: 'http://127.0.0.1:8100/callback'
        });
        
        // Set tokens if available
        if (config.accessToken && config.refreshToken) {
            this.spotifyApi.setAccessToken(config.accessToken);
            this.spotifyApi.setRefreshToken(config.refreshToken);
            
            // Verify tokens are still valid
            this.verifyTokens();
        } else {
            console.log("MMM-POSpotify: No tokens found. Please authorize the application.");
            this.sendSocketNotification("AUTH_ERROR", "No tokens found");
        }
    },
    
    // Verify and refresh tokens if needed
    verifyTokens: async function() {
        try {
            // Try to get current playback
            await this.spotifyApi.getMyCurrentPlaybackState();
            console.log("MMM-POSpotify: Tokens are valid");
        } catch (error) {
            if (error.statusCode === 401) {
                // Token expired, refresh it
                console.log("MMM-POSpotify: Access token expired, refreshing...");
                await this.refreshAccessToken();
            } else {
                console.error("MMM-POSpotify: Token verification error:", error);
                this.sendSocketNotification("API_ERROR", error);
            }
        }
    },
    
    // Refresh access token
    refreshAccessToken: async function() {
        try {
            const data = await this.spotifyApi.refreshAccessToken();
            const accessToken = data.body['access_token'];
            
            this.spotifyApi.setAccessToken(accessToken);
            this.tokenExpirationTime = Date.now() + (data.body['expires_in'] * 1000);
            
            console.log("MMM-POSpotify: Access token refreshed successfully");
            this.sendSocketNotification("TOKEN_REFRESHED", accessToken);
            
            // Save new token to config file if needed
            this.saveTokens(accessToken, this.config.refreshToken);
            
        } catch (error) {
            console.error("MMM-POSpotify: Error refreshing token:", error);
            this.sendSocketNotification("AUTH_ERROR", "Token refresh failed");
        }
    },
    
    // Get currently playing track
    getCurrentlyPlaying: async function() {
        if (!this.spotifyApi) {
            return;
        }
        
        // Check if token needs refresh
        if (Date.now() > this.tokenExpirationTime - 60000) { // Refresh 1 minute before expiry
            await this.refreshAccessToken();
        }
        
        try {
            const response = await this.spotifyApi.getMyCurrentPlaybackState();
            
            if (response.body && response.body.item) {
                this.sendSocketNotification("SONG_DATA", response.body);
            } else {
                this.sendSocketNotification("PLAYER_STOPPED");
            }
            
        } catch (error) {
            if (error.statusCode === 401) {
                // Try refreshing token once more
                await this.refreshAccessToken();
                // Retry the request
                this.getCurrentlyPlaying();
            } else if (error.statusCode === 204) {
                // No playback active
                this.sendSocketNotification("PLAYER_STOPPED");
            } else {
                console.error("MMM-POSpotify: Error getting current playback:", error);
                this.sendSocketNotification("API_ERROR", error);
            }
        }
    },
    
    // Control playback
    controlPlayback: async function(action) {
        if (!this.spotifyApi) return;
        
        try {
            switch(action) {
                case "play":
                    await this.spotifyApi.play();
                    break;
                case "pause":
                    await this.spotifyApi.pause();
                    break;
                case "next":
                    await this.spotifyApi.skipToNext();
                    break;
                case "previous":
                    await this.spotifyApi.skipToPrevious();
                    break;
            }
            
            // Get updated state after control action
            setTimeout(() => {
                this.getCurrentlyPlaying();
            }, 300);
            
        } catch (error) {
            console.error(`MMM-POSpotify: Error controlling playback (${action}):`, error);
            this.sendSocketNotification("API_ERROR", error);
        }
    },
    
    // Control volume
    controlVolume: async function(notification, amount = 5) {
        if (!this.spotifyApi) return;
        
        try {
            // Get current volume
            const state = await this.spotifyApi.getMyCurrentPlaybackState();
            if (!state.body || !state.body.device) return;
            
            let newVolume = state.body.device.volume_percent;
            
            if (notification === "SPOTIFY_VOLUME_UP") {
                newVolume = Math.min(100, newVolume + amount);
            } else {
                newVolume = Math.max(0, newVolume - amount);
            }
            
            await this.spotifyApi.setVolume(newVolume);
            
        } catch (error) {
            console.error("MMM-POSpotify: Error controlling volume:", error);
        }
    },
    
    // Start authorization server
    startAuthServer: function() {
        const app = express();
        const PORT = 8100;
        
        // Serve authorization page
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'auth', 'index.html'));
        });
        
        // Serve static files
        app.use('/auth', express.static(path.join(__dirname, 'auth')));
        
        // Start authorization
        app.get('/authorize', (req, res) => {
            if (!this.spotifyApi) {
                res.status(400).send('Spotify API not initialized. Please configure the module first.');
                return;
            }
            
            const scopes = [
                'user-read-playback-state',
                'user-modify-playback-state',
                'user-read-currently-playing',
                'user-read-recently-played',
                'user-top-read',
                'user-read-playback-position',
                'streaming',
                'user-read-email',
                'user-read-private'
            ];
            
            const state = Date.now().toString();
            const authorizeURL = this.spotifyApi.createAuthorizeURL(scopes, state);
            
            // Use 127.0.0.1 instead of localhost for security compliance
            const secureURL = authorizeURL.replace('localhost', '127.0.0.1');
            
            res.redirect(secureURL);
        });
        
        // Handle callback
        app.get('/callback', async (req, res) => {
            const { code, error } = req.query;
            
            if (error) {
                res.send(`Authorization failed: ${error}`);
                return;
            }
            
            try {
                const data = await this.spotifyApi.authorizationCodeGrant(code);
                const { access_token, refresh_token, expires_in } = data.body;
                
                // Set tokens
                this.spotifyApi.setAccessToken(access_token);
                this.spotifyApi.setRefreshToken(refresh_token);
                
                // Save tokens
                this.saveTokens(access_token, refresh_token);
                
                // Calculate expiration time
                this.tokenExpirationTime = Date.now() + (expires_in * 1000);
                
                // Generate config snippet
                const configSnippet = `
                    {
                        module: "MMM-POSpotify",
                        position: "top_right",
                        config: {
                            clientID: "${this.config.clientID}",
                            clientSecret: "${this.config.clientSecret}",
                            accessToken: "${access_token}",
                            refreshToken: "${refresh_token}",
                            // Add other configuration options as needed
                        }
                    }
                `;
                
                res.send(`
                    <html>
                        <head>
                            <title>Authorization Successful</title>
                            <style>
                                body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a1a; color: #fff; }
                                .container { max-width: 800px; margin: 0 auto; }
                                .success { color: #1DB954; font-size: 24px; margin-bottom: 20px; }
                                pre { background: #2a2a2a; padding: 20px; border-radius: 5px; overflow-x: auto; }
                                code { color: #1DB954; }
                                .note { background: #2a2a2a; padding: 15px; border-radius: 5px; margin-top: 20px; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1 class="success">✓ Authorization Successful!</h1>
                                <p>Your Spotify account has been successfully linked. Copy the configuration below and add it to your <code>config.js</code> file:</p>
                                <pre><code>${this.escapeHtml(configSnippet)}</code></pre>
                                <div class="note">
                                    <strong>Note:</strong> Your tokens are securely stored and will be automatically refreshed when needed.
                                </div>
                            </div>
                        </body>
                    </html>
                `);
                
            } catch (error) {
                console.error('Authorization error:', error);
                res.send(`Authorization failed: ${error.message}`);
            }
        });
        
        // Start server
        const server = app.listen(PORT, '127.0.0.1', () => {
            console.log(`MMM-POSpotify: Authorization server running at http://127.0.0.1:${PORT}`);
            console.log(`To authorize, configure the module with your clientID and clientSecret, then visit http://127.0.0.1:${PORT}`);
        });
        
        // Don't let the auth server block the module
        server.unref();
    },
    
    // Save tokens to file
    saveTokens: function(accessToken, refreshToken) {
        const tokenFile = path.join(__dirname, '.spotify-tokens.json');
        const tokens = {
            accessToken: accessToken,
            refreshToken: refreshToken,
            savedAt: new Date().toISOString()
        };
        
        try {
            fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
            console.log("MMM-POSpotify: Tokens saved successfully");
        } catch (error) {
            console.error("MMM-POSpotify: Error saving tokens:", error);
        }
    },
    
    // Load saved tokens
    loadTokens: function() {
        const tokenFile = path.join(__dirname, '.spotify-tokens.json');
        
        try {
            if (fs.existsSync(tokenFile)) {
                const tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
                return tokens;
            }
        } catch (error) {
            console.error("MMM-POSpotify: Error loading tokens:", error);
        }
        
        return null;
    },
    
    // Escape HTML for safe display
    escapeHtml: function(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        
        return text.replace(/[&<>"']/g, m => map[m]);
    }
});