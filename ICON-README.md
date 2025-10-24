# Extension Icon

## Requirements

VSCode extensions require a PNG icon (not SVG) with the following specifications:
- Format: PNG
- Size: 128x128 pixels
- Transparent background recommended
- Should represent dataflow/graph visualization

## Current Status

An SVG design is available in `icon.svg` but needs to be converted to PNG.

## Creating the Icon

### Option 1: Convert SVG to PNG

Use an online tool or command-line utility:

```bash
# Using ImageMagick
convert -background none -size 128x128 icon.svg icon.png

# Using Inkscape
inkscape icon.svg --export-type=png --export-filename=icon.png -w 128 -h 128

# Using rsvg-convert
rsvg-convert -w 128 -h 128 icon.svg -o icon.png
```

### Option 2: Create PNG Directly

Use a graphics editor like:
- GIMP
- Photoshop
- Figma
- Sketch
- Canva

Design guidelines:
- Use Hydro brand colors (blue: #2563eb)
- Include dataflow/graph elements (nodes, edges, arrows)
- Keep it simple and recognizable at small sizes
- Ensure it works on both light and dark backgrounds

### Option 3: Use Existing Hydro Branding

If Hydro project has existing logo/icon assets, use those for consistency.

## Adding to Extension

Once you have `icon.png`:

1. Place it in the `hydroscope-ide/` directory
2. Update `package.json`:
   ```json
   {
     "icon": "icon.png"
   }
   ```
3. Rebuild and package:
   ```bash
   npm run build
   npm run package
   ```

## Design Concept

The current SVG design includes:
- Three nodes representing dataflow components
- Arrows showing data flow direction
- Wave accent representing "Hydro"
- Blue color scheme matching Hydro branding

Feel free to iterate on this design or create something new that better represents the extension's purpose.
