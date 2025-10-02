export interface BitmapOptions {
  gridSize: number;
  color: string;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 255, g: 255, b: 255 };
}

export function processImageToBitmap(
  img: HTMLImageElement,
  options: BitmapOptions
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('failed to get canvas context');

  canvas.width = options.gridSize;
  canvas.height = options.gridSize;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, options.gridSize, options.gridSize);

  const imageData = ctx.getImageData(0, 0, options.gridSize, options.gridSize);
  const data = imageData.data;

  const color = hexToRgb(options.color);

  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const alpha = data[i + 3];
    const binary = avg > 128 && alpha > 128 ? 1 : 0;
    data[i] = binary * color.r;
    data[i + 1] = binary * color.g;
    data[i + 2] = binary * color.b;
    data[i + 3] = binary * 255; // Transparent background (0), opaque foreground (255)
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function canvasToSVG(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('failed to get canvas context');

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const grid: (string | null)[][] = [];
  for (let y = 0; y < canvas.height; y++) {
    grid[y] = [];
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      grid[y][x] =
        r > 0 || g > 0 || b > 0
          ? '#' +
            [r, g, b]
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')
          : null;
    }
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">\n`;

  const visited: boolean[][] = Array(canvas.height)
    .fill(null)
    .map(() => Array(canvas.width).fill(false));

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (visited[y][x] || !grid[y][x]) continue;

      const color = grid[y][x];
      let width = 0;

      while (
        x + width < canvas.width &&
        grid[y][x + width] === color &&
        !visited[y][x + width]
      ) {
        width++;
      }

      let height = 1;
      let canExtend = true;
      while (y + height < canvas.height && canExtend) {
        for (let i = 0; i < width; i++) {
          if (
            grid[y + height][x + i] !== color ||
            visited[y + height][x + i]
          ) {
            canExtend = false;
            break;
          }
        }
        if (canExtend) height++;
      }

      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          visited[y + dy][x + dx] = true;
        }
      }

      svg += `  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>\n`;
    }
  }

  svg += '</svg>';
  return svg;
}

export async function loadSVGFromText(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to load svg'));
    };

    img.src = url;
  });
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('failed to read file'));
    reader.readAsDataURL(file);
  });
}