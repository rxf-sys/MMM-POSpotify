/* node_helper.js - Fixed version with better token handling
 *
 * Node helper for MMM-POSpotify
 * Handles Spotify Web API communication with improved error handling
 */

const NodeHelper = require("node_helper");
const SpotifyWebApi = require("spotify-web-api-node");
const express = require("express");
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
        this.refreshTokenRetries = 0;
        this.maxRefreshRetries = 3;

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

        // Check for saved tokens first
        const savedTokens = this.loadTokens();

        if (savedTokens && savedTokens.refreshToken) {
            console.log("MMM-POSpotify: Loading saved tokens");
            this.spotifyApi.setAccessToken(savedTokens.accessToken);
            this.spotifyApi.setRefreshToken(savedTokens.refreshToken);
            this.config.refreshToken = savedTokens.refreshToken; // Ensure config has refresh token
            this.verifyTokens();
        } else if (config.accessToken && config.refreshToken) {
            console.log("MMM-POSpotify: Using tokens from config");
            this.spotifyApi.setAccessToken(config.accessToken);
            this.spotifyApi.setRefreshToken(config.refreshToken);

            // Save tokens for future use
            this.saveTokens(config.accessToken, config.refreshToken);
            this.verifyTokens();
        } else {
            console.log("MMM-POSpotify: No tokens found. Please authorize the application.");
            console.log("Visit http://127.0.0.1:8100 to authorize");
            this.sendSocketNotification("AUTH_ERROR", "No tokens found. Please visit http://127.0.0.1:8100 to authorize.");
        }
    },

    // Verify and refresh tokens if needed
    verifyTokens: async function() {
        try {
            // Try to get current playback
            const response = await this.spotifyApi.getMyCurrentPlaybackState();
            console.log("MMM-POSpotify: Tokens are valid");
            this.refreshTokenRetries = 0; // Reset retry counter on success
        } catch (error) {
            if (error.statusCode === 401) {
                // Token expired, refresh it
                console.log("MMM-POSpotify: Access token expired, refreshing...");
                await this.refreshAccessToken();
            } else if (error.statusCode === 204) {
                // No playback active, but tokens are valid
                console.log("MMM-POSpotify: No active playback, but tokens are valid");
                this.refreshTokenRetries = 0;
            } else {
                console.error("MMM-POSpotify: Token verification error:", error.message);
                this.sendSocketNotification("API_ERROR", error.message);
            }
        }
    },

    // Refresh access token with better error handling
    refreshAccessToken: async function() {
        // Check if we have a refresh token
        const refreshToken = this.spotifyApi.getRefreshToken();

        if (!refreshToken) {
            console.error("MMM-POSpotify: No refresh token available!");

            // Try to load from saved tokens
            const savedTokens = this.loadTokens();
            if (savedTokens && savedTokens.refreshToken) {
                console.log("MMM-POSpotify: Found saved refresh token, retrying...");
                this.spotifyApi.setRefreshToken(savedTokens.refreshToken);
            } else {
                console.error("MMM-POSpotify: Cannot refresh without refresh token. Please re-authorize.");
                this.sendSocketNotification("AUTH_ERROR", "Missing refresh token. Please re-authorize at http://127.0.0.1:8100");
                return;
            }
        }

        try {
            const data = await this.spotifyApi.refreshAccessToken();
            const accessToken = data.body['access_token'];

            this.spotifyApi.setAccessToken(accessToken);
            this.tokenExpirationTime = Date.now() + (data.body['expires_in'] * 1000);

            console.log("MMM-POSpotify: Access token refreshed successfully");
            this.sendSocketNotification("TOKEN_REFRESHED", accessToken);

            // Save new token (keep the existing refresh token)
            this.saveTokens(accessToken, this.spotifyApi.getRefreshToken());

            // Reset retry counter on success
            this.refreshTokenRetries = 0;

        } catch (error) {
            console.error("MMM-POSpotify: Error refreshing token:", error.message);

            // If refresh failed, try loading saved tokens one more time
            if (this.refreshTokenRetries < this.maxRefreshRetries) {
                this.refreshTokenRetries++;
                console.log(`MMM-POSpotify: Retrying token refresh (${this.refreshTokenRetries}/${this.maxRefreshRetries})`);

                // Clear tokens and reload from saved
                this.spotifyApi.resetAccessToken();
                this.spotifyApi.resetRefreshToken();

                const savedTokens = this.loadTokens();
                if (savedTokens) {
                    this.spotifyApi.setAccessToken(savedTokens.accessToken);
                    this.spotifyApi.setRefreshToken(savedTokens.refreshToken);

                    // Try again after a short delay
                    setTimeout(() => {
                        this.refreshAccessToken();
                    }, 2000);
                } else {
                    this.sendSocketNotification("AUTH_ERROR", "Token refresh failed. Please re-authorize at http://127.0.0.1:8100");
                }
            } else {
                this.sendSocketNotification("AUTH_ERROR", "Maximum refresh attempts reached. Please re-authorize at http://127.0.0.1:8100");
            }
        }
    },

    // Get currently playing track
    getCurrentlyPlaying: async function() {
        if (!this.spotifyApi) {
            return;
        }

        // Check if we have tokens
        if (!this.spotifyApi.getAccessToken()) {
            console.error("MMM-POSpotify: No access token available");
            this.sendSocketNotification("AUTH_ERROR", "No access token. Please authorize at http://127.0.0.1:8100");
            return;
        }

        // Check if token needs refresh (1 minute before expiry)
        if (this.tokenExpirationTime && Date.now() > this.tokenExpirationTime - 60000) {
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
                console.log("MMM-POSpotify: Got 401, attempting token refresh");
                await this.refreshAccessToken();

                // Only retry if refresh was successful
                if (this.spotifyApi.getAccessToken()) {
                    setTimeout(() => {
                        this.getCurrentlyPlaying();
                    }, 1000);
                }
            } else if (error.statusCode === 204) {
                // No playback active
                this.sendSocketNotification("PLAYER_STOPPED");
            } else {
                console.error("MMM-POSpotify: Error getting current playback:", error.message);
                this.sendSocketNotification("API_ERROR", error.message);
            }
        }
    },

    // Control playback
    controlPlayback: async function(action) {
        if (!this.spotifyApi || !this.spotifyApi.getAccessToken()) {
            console.error("MMM-POSpotify: Cannot control playback - not authenticated");
            return;
        }

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
            console.error(`MMM-POSpotify: Error controlling playback (${action}):`, error.message);

            if (error.statusCode === 401) {
                await this.refreshAccessToken();
            } else {
                this.sendSocketNotification("API_ERROR", error.message);
            }
        }
    },

    // Control volume
    controlVolume: async function(notification, amount = 5) {
        if (!this.spotifyApi || !this.spotifyApi.getAccessToken()) return;

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
            console.error("MMM-POSpotify: Error controlling volume:", error.message);
        }
    },

    // Start authorization server
    startAuthServer: function() {
        const app = express();
        const PORT = 8100;

        // Serve authorization page
        app.get('/', (req, res) => {
            const authPath = path.join(__dirname, 'auth', 'index.html');
            if (fs.existsSync(authPath)) {
                res.sendFile(authPath);
            } else {
                res.send(this.getBasicAuthPage());
            }
        });

        // Serve static files
        app.use('/auth', express.static(path.join(__dirname, 'auth')));

        // Start authorization
        app.get('/authorize', (req, res) => {
            if (!this.spotifyApi) {
                // Try to create API instance with default config
                this.spotifyApi = new SpotifyWebApi({
                    redirectUri: 'http://127.0.0.1:8100/callback'
                });
            }

            // Check if we have client credentials
            if (!this.spotifyApi.getClientId() && this.config) {
                this.spotifyApi.setClientId(this.config.clientID);
                this.spotifyApi.setClientSecret(this.config.clientSecret);
            }

            if (!this.spotifyApi.getClientId()) {
                res.status(400).send('Spotify API not configured. Please add clientID and clientSecret to your config.');
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

            res.redirect(authorizeURL);
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

                // Save tokens immediately
                this.saveTokens(access_token, refresh_token);

                // Calculate expiration time
                this.tokenExpirationTime = Date.now() + (expires_in * 1000);

                console.log("MMM-POSpotify: Authorization successful!");
                console.log("MMM-POSpotify: Refresh token:", refresh_token ? "Received" : "NOT RECEIVED!");

                // Generate config snippet
                const configSnippet = `
{
    module: "MMM-POSpotify",
    position: "top_right",
    config: {
        clientID: "${this.spotifyApi.getClientId()}",
        clientSecret: "${this.spotifyApi.getClientSecret()}",
        accessToken: "${access_token}",
        refreshToken: "${refresh_token}",
        // Add other configuration options as needed
    }
}
                `;

                res.send(this.getSuccessPage(configSnippet));

                // Notify the module
                this.sendSocketNotification("AUTH_SUCCESS", {
                    accessToken: access_token,
                    refreshToken: refresh_token
                });

            } catch (error) {
                console.error('Authorization error:', error);
                res.send(`Authorization failed: ${error.message}`);
            }
        });

        // Status endpoint
        app.get('/status', (req, res) => {
            const hasTokens = this.spotifyApi && this.spotifyApi.getAccessToken() && this.spotifyApi.getRefreshToken();
            res.json({
                configured: !!this.config,
                authenticated: hasTokens,
                hasRefreshToken: !!(this.spotifyApi && this.spotifyApi.getRefreshToken())
            });
        });

        // Start server
        const server = app.listen(PORT, '127.0.0.1', () => {
            console.log(`MMM-POSpotify: Authorization server running at http://127.0.0.1:${PORT}`);
            console.log(`To authorize, visit http://127.0.0.1:${PORT}`);
        });

        // Don't let the auth server block the module
        server.unref();
    },

    // Save tokens to file
    saveTokens: function(accessToken, refreshToken) {
        if (!accessToken || !refreshToken) {
            console.error("MMM-POSpotify: Cannot save tokens - missing data");
            console.error("AccessToken:", accessToken ? "Present" : "Missing");
            console.error("RefreshToken:", refreshToken ? "Present" : "Missing");
            return;
        }

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
                console.log("MMM-POSpotify: Loaded saved tokens");
                console.log("RefreshToken:", tokens.refreshToken ? "Present" : "Missing");
                return tokens;
            }
        } catch (error) {
            console.error("MMM-POSpotify: Error loading tokens:", error);
        }

        return null;
    },

    // Basic auth page HTML
    getBasicAuthPage: function() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>MMM-POSpotify Authorization</title>
    <style>
        body { font-family: Arial, sans-serif; background: #191414; color: white; padding: 40px; text-align: center; }
        .container { max-width: 600px; margin: 0 auto; }
        h1 { color: #1DB954; }
        .button { display: inline-block; background: #1DB954; color: black; padding: 15px 30px; text-decoration: none; border-radius: 30px; font-weight: bold; margin: 20px 0; }
        .button:hover { background: #1ED760; }
        .error { background: #ff4444; padding: 20px; border-radius: 10px; margin: 20px 0; }
        .info { background: #333; padding: 20px; border-radius: 10px; margin: 20px 0; }
        code { background: #000; padding: 2px 5px; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>MMM-POSpotify Authorization</h1>
        <div class="info">
            <p>Make sure you have configured your Spotify App with:</p>
            <p>Redirect URI: <code>http://127.0.0.1:8100/callback</code></p>
        </div>
        <a href="/authorize" class="button">Connect with Spotify</a>
    </div>
</body>
</html>
        `;
    },

    // Success page HTML
    getSuccessPage: function(configSnippet) {
        return `
<!DOCTYPE html>
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
        .warning { background: #ff4444; padding: 15px; border-radius: 5px; margin: 20px 0; }
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
        <div class="warning">
            <strong>Important:</strong> Make sure to include both accessToken AND refreshToken in your config!
        </div>
    </div>
</body>
</html>
        `;
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
