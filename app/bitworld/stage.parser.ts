// Stage template parser and renderer for .nara files
import type { Point, WorldData, ImageData } from './world.engine';

// Safe expression evaluator for .nara templates
// Only allows math operations - no arbitrary code execution
function safeEval(expr: string, context: Record<string, number>): number {
  // Replace context variables with their values
  let evaluated = expr;
  for (const [key, value] of Object.entries(context)) {
    // Use word boundaries to avoid partial matches
    evaluated = evaluated.replace(new RegExp(`\\b${key}\\b`, 'g'), String(value));
  }

  // Security: Only allow numbers, whitespace, and basic math operators
  // This prevents code injection attacks
  if (!/^[\d\s+\-*/.()]+$/.test(evaluated)) {
    console.warn('[NARA] Invalid expression detected:', expr);
    return 0;
  }

  try {
    // Use Function constructor in strict mode (safer than eval)
    // Still evaluates math, but can't access outer scope or execute arbitrary code
    return Math.floor(new Function(`'use strict'; return (${evaluated})`)());
  } catch (error) {
    console.error('[NARA] Expression evaluation failed:', expr, error);
    return 0;
  }
}

export interface StageTemplate {
  version: string;
  type: string;
  name: string;
  description?: string;
  parameters: {
    imageUrl: {
      type: string;
      default: string;
      description?: string;
    };
    cursorPos?: {
      type: string;
      description?: string;
    };
  };
  layout: {
    imageWidth: number;
    spacing: {
      titleAboveImage: number;
      captionBelowImage: number;
      sidebarFromImage: number;
      footerBelowCaption: number;
    };
  };
  regions: StageRegion[];
  textGenerator: {
    name: string;
    dictionary: string[];
  };
  storage: {
    text: string;
    images: string;
    ephemeral: boolean;
    clearKey: string;
  };
}

export interface StageRegion {
  id: string;
  type: 'text' | 'image' | 'composite';
  position: Record<string, any>;
  content?: Record<string, any>;
  dimensions?: Record<string, any>;
  source?: string;
  layout?: Record<string, any>;
  components?: StageRegion[];
}

export interface RenderedArtifact {
  textData: WorldData;
  imageData: ImageData[];
}

// Generate bogus text based on template dictionary
function generateBogusText(dictionary: string[], wordCount: number): string {
  let result = '';
  for (let i = 0; i < wordCount; i++) {
    result += dictionary[Math.floor(Math.random() * dictionary.length)] + ' ';
  }
  return result.trim();
}

// Word wrap text to specified width
function wordWrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Word longer than maxWidth, split it
        lines.push(word.substring(0, maxWidth));
        currentLine = word.substring(maxWidth);
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Render a single region to textData
function renderRegion(
  region: StageRegion,
  context: {
    startX: number;
    startY: number;
    imageWidth: number;
    imageHeight: number;
    dictionary: string[];
  },
  textData: WorldData
): void {
  // Evaluate position expressions using safe evaluator
  const evalPosition = (expr: string): number => {
    const ctx = {
      startX: context.startX,
      startY: context.startY,
      imageWidth: context.imageWidth,
      imageHeight: context.imageHeight,
    };

    return safeEval(expr, ctx);
  };

  const x = evalPosition(region.position.x);
  const y = evalPosition(region.position.y);

  // Track region bounds for border drawing
  let regionWidth = 0;
  let regionHeight = 0;

  if (region.type === 'text' && region.content) {
    // Generate text content
    let text = '';

    if (region.content.static) {
      text = region.content.static;
    } else if (region.content.generator === 'bogus' && region.content.wordCount) {
      text = generateBogusText(context.dictionary, region.content.wordCount);
    } else if (region.content.repeat) {
      text = region.content.repeat.repeat(region.content.count || 1);
    }

    // Apply transforms
    if (region.content.transform === 'uppercase') {
      text = text.toUpperCase();
    }

    // Add prefix/suffix
    if (region.content.prefix) text = region.content.prefix + text;
    if (region.content.suffix) text = text + region.content.suffix;

    // Handle layout
    if (region.layout?.wrap && region.layout?.width) {
      // Word wrap
      const lines = wordWrapText(text, region.layout.width);
      regionWidth = Math.max(...lines.map(l => l.length));
      regionHeight = lines.length;

      lines.forEach((line, lineIndex) => {
        for (let i = 0; i < line.length; i++) {
          const key = `${x + i},${y + lineIndex}`;
          textData[key] = line[i];
        }
      });
    } else if (region.layout?.alignment === 'center' && region.layout?.width) {
      // Center align
      regionWidth = region.layout.width;
      regionHeight = 1;

      const startX = x + Math.floor((region.layout.width - text.length) / 2);
      for (let i = 0; i < text.length; i++) {
        const key = `${startX + i},${y}`;
        textData[key] = text[i];
      }
    } else {
      // Default: left align, single line
      regionWidth = text.length;
      regionHeight = 1;

      for (let i = 0; i < text.length; i++) {
        const key = `${x + i},${y}`;
        textData[key] = text[i];
      }
    }

  } else if (region.type === 'composite' && region.components) {
    // Render composite components
    const compositeContext = {
      ...context,
      sidebarX: x,
      sidebarStartY: y,
    };

    region.components.forEach(component => {
      // Update component positions relative to composite
      const componentRegion = {
        ...component,
        position: {
          x: component.position.x.replace(/sidebarX/g, String(x)).replace(/sidebarStartY/g, String(y)),
          y: component.position.y.replace(/sidebarX/g, String(x)).replace(/sidebarStartY/g, String(y)),
        }
      };
      renderRegion(componentRegion, compositeContext, textData);
    });
  }
}

// Parse and render a .nara stage template from file content
// .nara files are JSON-based templates with generative content capabilities
export async function parseAndRenderTemplate(
  templateContent: string,
  cursorPos: Point,
  imageUrl?: string
): Promise<RenderedArtifact> {
  // Parse .nara template (JSON format)
  const template: StageTemplate = JSON.parse(templateContent);

  // Use provided imageUrl or template default
  const finalImageUrl = imageUrl || template.parameters.imageUrl.default;

  // Load image to get dimensions
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const imageWidth = template.layout.imageWidth;
      const aspectRatio = img.height / img.width;
      const imageHeight = Math.round(imageWidth * aspectRatio);

      const context = {
        startX: cursorPos.x,
        startY: cursorPos.y,
        imageWidth,
        imageHeight,
        dictionary: template.textGenerator.dictionary,
      };

      // Render text regions
      const textData: WorldData = {};

      template.regions.forEach(region => {
        if (region.type !== 'image') {
          renderRegion(region, context, textData);
        }
      });

      // Create image data
      const imageData: ImageData[] = [];
      const imageRegion = template.regions.find(r => r.type === 'image');

      if (imageRegion) {
        imageData.push({
          type: 'image',
          src: finalImageUrl,
          startX: cursorPos.x,
          startY: cursorPos.y,
          endX: cursorPos.x + imageWidth,
          endY: cursorPos.y + imageHeight,
          originalWidth: img.width,
          originalHeight: img.height,
        });
      }

      resolve({ textData, imageData });
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = finalImageUrl;
  });
}
