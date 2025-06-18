/* color-extractor.js
 * 
 * Simple color extraction from album art
 * Uses Canvas API to extract dominant colors
 */

const ColorExtractor = {
    extract: function(imageUrl, callback) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Scale down for performance
                const scaleFactor = 0.1;
                canvas.width = img.width * scaleFactor;
                canvas.height = img.height * scaleFactor;
                
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                
                // Extract colors
                const colors = ColorExtractor.getColorPalette(data);
                
                // Return color scheme
                callback({
                    primary: colors.vibrant || '#1DB954',
                    secondary: colors.muted || '#535353',
                    background: ColorExtractor.darken(colors.dark || '#191414', 0.7),
                    accent: colors.vibrant || '#1DB954'
                });
                
            } catch (error) {
                console.error('Color extraction failed:', error);
                callback({
                    primary: '#1DB954',
                    secondary: '#535353',
                    background: '#191414',
                    accent: '#1DB954'
                });
            }
        };
        
        img.onerror = function() {
            callback({
                primary: '#1DB954',
                secondary: '#535353',
                background: '#191414',
                accent: '#1DB954'
            });
        };
        
        img.src = imageUrl;
    },
    
    getColorPalette: function(data) {
        const colorCounts = {};
        const colors = {
            vibrant: null,
            muted: null,
            dark: null,
            light: null
        };
        
        // Sample colors
        for (let i = 0; i < data.length; i += 40) { // Sample every 10th pixel (4 bytes per pixel)
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            
            if (a < 200) continue; // Skip transparent pixels
            
            const rgb = `${r},${g},${b}`;
            colorCounts[rgb] = (colorCounts[rgb] || 0) + 1;
        }
        
        // Sort by frequency
        const sortedColors = Object.entries(colorCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([rgb]) => {
                const [r, g, b] = rgb.split(',').map(Number);
                return { r, g, b };
            });
        
        // Categorize colors
        sortedColors.forEach(color => {
            const { r, g, b } = color;
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            const saturation = ColorExtractor.getSaturation(r, g, b);
            
            if (!colors.vibrant && saturation > 0.5 && brightness > 80 && brightness < 200) {
                colors.vibrant = ColorExtractor.rgbToHex(r, g, b);
            }
            if (!colors.muted && saturation < 0.3 && brightness > 50 && brightness < 200) {
                colors.muted = ColorExtractor.rgbToHex(r, g, b);
            }
            if (!colors.dark && brightness < 80) {
                colors.dark = ColorExtractor.rgbToHex(r, g, b);
            }
            if (!colors.light && brightness > 200) {
                colors.light = ColorExtractor.rgbToHex(r, g, b);
            }
        });
        
        return colors;
    },
    
    getSaturation: function(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        
        if (max === 0) return 0;
        return delta / max;
    },
    
    rgbToHex: function(r, g, b) {
        return '#' + [r, g, b].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    },
    
    darken: function(hex, factor) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.floor((num >> 16) * factor);
        const g = Math.floor(((num >> 8) & 0x00FF) * factor);
        const b = Math.floor((num & 0x0000FF) * factor);
        
        return ColorExtractor.rgbToHex(r, g, b);
    }
};

// Export for use in module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ColorExtractor;
}