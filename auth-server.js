/* auth-server.js
 * Standalone authorization server for MMM-POSpotify
 * Run this to authorize Spotify without starting MagicMirror
 */

const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = 8100;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

// Read config if exists
let config = {
    clientID: '',
    clientSecret: ''
};

// Try to read from config file
const configPath = path.join(__dirname, 'spotify-config.json');
if (fs.existsSync(configPath)) {
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('✓ Loaded config from spotify-config.json');
    } catch (e) {
        console.log('✗ Could not read spotify-config.json');
    }
}

// Command line arguments override config file
if (process.argv[2]) config.clientID = process.argv[2];
if (process.argv[3]) config.clientSecret = process.argv[3];

// Check if we have credentials
if (!config.clientID || !config.clientSecret) {
    console.log('\n❌ Missing Spotify credentials!\n');
    console.log('Usage: node auth-server.js <CLIENT_ID> <CLIENT_SECRET>');
    console.log('Or create spotify-config.json with:');
    console.log(JSON.stringify({
        clientID: "your_client_id",
        clientSecret: "your_client_secret"
    }, null, 2));
    process.exit(1);
}

// Create Spotify API instance
const spotifyApi = new SpotifyWebApi({
    clientId: config.clientID,
    clientSecret: config.clientSecret,
    redirectUri: REDIRECT_URI
});

// Create Express app
const app = express();

// Homepage
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>MMM-POSpotify Authorization</title>
    <style>
        body {
            font-family: -apple-system, Arial, sans-serif;
            background: #191414;
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            max-width: 500px;
            padding: 40px;
            background: rgba(255,255,255,0.05);
            border-radius: 20px;
        }
        h1 { color: #1DB954; margin-bottom: 10px; }
        .subtitle { color: #b3b3b3; margin-bottom: 30px; }
        .button {
            display: inline-block;
            background: #1DB954;
            color: black;
            padding: 15px 40px;
            text-decoration: none;
            border-radius: 30px;
            font-weight: bold;
            font-size: 16px;
            margin: 20px 0;
            transition: all 0.3s;
        }
        .button:hover {
            background: #1ED760;
            transform: scale(1.05);
        }
        .info {
            background: rgba(255,255,255,0.1);
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
            font-size: 14px;
        }
        code {
            background: black;
            padding: 2px 8px;
            border-radius: 4px;
            font-family: monospace;
        }
        .status {
            margin-top: 20px;
            padding: 10px;
            border-radius: 5px;
            font-size: 14px;
        }
        .success { background: rgba(29, 185, 84, 0.2); color: #1DB954; }
        .error { background: rgba(255, 68, 68, 0.2); color: #ff4444; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 MMM-POSpotify</h1>
        <p class="subtitle">Spotify Authorization</p>

        <div class="info">
            <strong>Client ID:</strong> <code>${config.clientID.substring(0, 8)}...</code><br>
            <strong>Redirect URI:</strong> <code>${REDIRECT_URI}</code>
        </div>

        <a href="/authorize" class="button">
            Connect with Spotify
        </a>

        <p style="color: #666; font-size: 12px; margin-top: 30px;">
            Make sure your Spotify app has the correct redirect URI
        </p>
    </div>
</body>
</html>
    `);
});

// Start authorization
app.get('/authorize', (req, res) => {
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
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);

    console.log('→ Redirecting to Spotify...');
    res.redirect(authorizeURL);
});

// Handle callback
app.get('/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
        console.error('✗ Authorization failed:', error);
        res.send(`
            <html>
            <body style="background: #191414; color: white; font-family: Arial; padding: 40px;">
                <h1 style="color: #ff4444;">❌ Authorization Failed</h1>
                <p>${error}</p>
                <a href="/" style="color: #1DB954;">Try again</a>
            </body>
            </html>
        `);
        return;
    }

    try {
        console.log('→ Exchanging code for tokens...');
        const data = await spotifyApi.authorizationCodeGrant(code);
        const { access_token, refresh_token, expires_in } = data.body;

        // Save tokens
        const tokenData = {
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresIn: expires_in,
            obtainedAt: new Date().toISOString()
        };

        // Save to file
        fs.writeFileSync(
            path.join(__dirname, '.spotify-tokens.json'),
            JSON.stringify(tokenData, null, 2)
        );

        console.log('✓ Tokens saved to .spotify-tokens.json');

        // Generate config
        const configSnippet = `{
    module: "MMM-POSpotify",
    position: "top_right",
    config: {
        clientID: "${config.clientID}",
        clientSecret: "${config.clientSecret}",
        accessToken: "${access_token}",
        refreshToken: "${refresh_token}"
    }
}`;

        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Success!</title>
    <style>
        body {
            font-family: -apple-system, Arial, sans-serif;
            background: #191414;
            color: white;
            padding: 40px;
            margin: 0;
        }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #1DB954; }
        .success-box {
            background: rgba(29, 185, 84, 0.1);
            border: 1px solid #1DB954;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
        }
        pre {
            background: #000;
            padding: 20px;
            border-radius: 10px;
            overflow-x: auto;
            border: 1px solid #333;
        }
        code { color: #1DB954; }
        .note {
            background: rgba(255,255,255,0.05);
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .button {
            display: inline-block;
            background: #1DB954;
            color: black;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 20px;
            font-weight: bold;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>✅ Authorization Successful!</h1>

        <div class="success-box">
            <strong>Tokens have been saved to:</strong><br>
            <code>${path.join(__dirname, '.spotify-tokens.json')}</code>
        </div>

        <h2>Add this to your config.js:</h2>
        <pre><code>${escapeHtml(configSnippet)}</code></pre>

        <div class="note">
            <strong>Important:</strong> Make sure to include BOTH accessToken and refreshToken!
            The tokens will be automatically refreshed when needed.
        </div>

        <a href="/" class="button">Done</a>
    </div>
</body>
</html>
        `);

        console.log('\n✅ Authorization successful!');
        console.log('Tokens saved. You can now close this window.\n');

    } catch (error) {
        console.error('✗ Token exchange failed:', error);
        res.status(500).send(`
            <html>
            <body style="background: #191414; color: white; font-family: Arial; padding: 40px;">
                <h1 style="color: #ff4444;">❌ Token Exchange Failed</h1>
                <pre>${error.message}</pre>
                <a href="/" style="color: #1DB954;">Try again</a>
            </body>
            </html>
        `);
    }
});

// Start server
const server = app.listen(PORT, '127.0.0.1', () => {
    console.log('\n🎵 MMM-POSpotify Authorization Server');
    console.log('=====================================\n');
    console.log(`✓ Server running at http://127.0.0.1:${PORT}`);
    console.log(`✓ Client ID: ${config.clientID.substring(0, 8)}...`);
    console.log(`✓ Redirect URI: ${REDIRECT_URI}`);
    console.log('\n→ Please open your browser and go to:');
    console.log(`  http://127.0.0.1:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down server...');
    server.close(() => {
        process.exit(0);
    });
});

// Helper function
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
