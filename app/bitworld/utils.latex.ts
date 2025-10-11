// LaTeX rendering utilities using KaTeX

import katex from 'katex';
import html2canvas from 'html2canvas';

/**
 * Renders LaTeX string to an SVG element
 */
export function renderLatexToSVG(latexString: string): SVGElement | null {
    try {
        // Create a temporary container
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '-9999px';
        document.body.appendChild(container);

        // Render KaTeX with SVG output
        katex.render(latexString, container, {
            throwOnError: false,
            displayMode: true, // Display mode for larger equations
            output: 'html' // KaTeX outputs HTML with SVG elements
        });

        // Extract the rendered content
        const renderedHTML = container.innerHTML;

        // Clean up
        document.body.removeChild(container);

        // Create an SVG wrapper with the rendered content
        const svgContainer = document.createElement('div');
        svgContainer.innerHTML = renderedHTML;

        // Get bounding box to determine size
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.innerHTML = renderedHTML;
        document.body.appendChild(tempDiv);

        const bbox = tempDiv.getBoundingClientRect();
        const width = Math.ceil(bbox.width);
        const height = Math.ceil(bbox.height);

        document.body.removeChild(tempDiv);

        // Create actual SVG element
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width.toString());
        svg.setAttribute('height', height.toString());
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Create foreignObject to embed HTML
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('width', width.toString());
        foreignObject.setAttribute('height', height.toString());
        foreignObject.innerHTML = renderedHTML;

        svg.appendChild(foreignObject);

        return svg;
    } catch (error) {
        console.error('Error rendering LaTeX to SVG:', error);
        return null;
    }
}

/**
 * Converts LaTeX string to a data URL image
 */
export async function convertLatexToImage(latexString: string): Promise<string | null> {
    try {
        console.log('Converting LaTeX:', latexString);

        // Create a temporary container for rendering
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '-9999px';
        container.style.background = 'white';
        container.style.padding = '5px';
        container.style.fontSize = '16px'; // Much smaller font for compact size
        document.body.appendChild(container);

        // Render KaTeX
        try {
            katex.render(latexString, container, {
                throwOnError: true,
                displayMode: true,
                output: 'html'
            });
            console.log('KaTeX rendered successfully');
            console.log('Container HTML:', container.innerHTML);
        } catch (e) {
            console.error('KaTeX render error:', e);
            document.body.removeChild(container);
            return null;
        }

        // Use html2canvas to capture the rendered element with all CSS
        const canvas = await html2canvas(container, {
            backgroundColor: '#ffffff',
            scale: 3 // High resolution for crisp rendering
        });

        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/png');

        // Clean up
        document.body.removeChild(container);

        return dataUrl;
    } catch (error) {
        console.error('Error converting LaTeX to image:', error);
        return null;
    }
}

/**
 * Converts LaTeX string to SVG data URL with transparent background and configurable text color
 */
export async function convertLatexToSVG(latexString: string, textColor: string = '#000000'): Promise<string | null> {
    try {
        // Create a temporary container for rendering
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '-9999px';
        container.style.padding = '5px';
        container.style.fontSize = '16px';
        container.style.color = textColor; // Set text color
        document.body.appendChild(container);

        // Render KaTeX
        try {
            katex.render(latexString, container, {
                throwOnError: true,
                displayMode: true,
                output: 'html'
            });
        } catch (e) {
            console.error('KaTeX render error:', e);
            document.body.removeChild(container);
            return null;
        }

        // Get bounding box
        const bbox = container.getBoundingClientRect();
        const width = Math.ceil(bbox.width);
        const height = Math.ceil(bbox.height);

        // Create SVG with foreignObject containing the rendered HTML
        const svgContent = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
                <foreignObject width="${width}" height="${height}">
                    <div xmlns="http://www.w3.org/1999/xhtml" style="color: ${textColor}; font-size: 16px; padding: 5px;">
                        ${container.innerHTML}
                    </div>
                </foreignObject>
            </svg>
        `;

        // Clean up
        document.body.removeChild(container);

        // Convert to data URL
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgContent)));

        return dataUrl;
    } catch (error) {
        console.error('Error converting LaTeX to SVG:', error);
        return null;
    }
}

/**
 * Quick validation of LaTeX string
 */
export function validateLatex(latexString: string): boolean {
    try {
        const container = document.createElement('div');
        katex.render(latexString, container, {
            throwOnError: true,
            displayMode: true
        });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Render LaTeX preview (for live preview below input)
 */
export function renderLatexPreview(latexString: string, targetElement: HTMLElement): boolean {
    try {
        katex.render(latexString, targetElement, {
            throwOnError: false,
            displayMode: true,
            output: 'html'
        });
        return true;
    } catch (error) {
        console.error('Error rendering LaTeX preview:', error);
        targetElement.textContent = 'Invalid LaTeX';
        return false;
    }
}
