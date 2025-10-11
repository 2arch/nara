// SMILES (Simplified Molecular Input Line Entry System) rendering utilities
// Uses OpenChemLib for molecular structure visualization

/**
 * Converts SMILES string to SVG data URL with transparent background and configurable color
 */
export async function convertSMILESToSVG(smilesString: string, color: string = '#000000'): Promise<string | null> {
    try {
        // Dynamically import OpenChemLib
        const OCL = await import('openchemlib');

        // Parse the SMILES string
        const molecule = OCL.Molecule.fromSmiles(smilesString);

        if (!molecule) {
            console.error('Failed to parse SMILES string');
            return null;
        }

        // Generate SVG with compact size
        // Note: OpenChemLib uses default atom colors and doesn't support custom color configuration
        const svg = molecule.toSVG(200, 150, undefined, {
            suppressChiralText: false,
            suppressESR: false,
            suppressCIPParity: false,
            noStereoProblem: false,
            factorTextSize: 0.8,
            strokeWidth: 1.2,
            fontWeight: 'normal',
        });

        // Convert SVG string to data URL
        const svgString = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);

        // Make background transparent by adding/modifying the fill attribute
        const transparentSvg = svgString.replace(
            /<svg([^>]*)>/,
            '<svg$1 style="background: transparent;">'
        );

        const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(transparentSvg)));

        return dataUrl;
    } catch (error) {
        console.error('Error converting SMILES to SVG:', error);
        return null;
    }
}

/**
 * Quick validation of SMILES string
 */
export async function validateSMILES(smilesString: string): Promise<boolean> {
    try {
        const OCL = await import('openchemlib');
        const molecule = OCL.Molecule.fromSmiles(smilesString);
        return molecule !== null && molecule !== undefined;
    } catch {
        return false;
    }
}

/**
 * Render SMILES preview (for live preview below input)
 */
export async function renderSMILESPreview(smilesString: string, targetElement: HTMLElement, color: string = '#000000'): Promise<boolean> {
    try {
        const OCL = await import('openchemlib');

        // Parse the SMILES string
        const molecule = OCL.Molecule.fromSmiles(smilesString);

        if (!molecule) {
            targetElement.textContent = 'Invalid SMILES';
            return false;
        }

        // Generate SVG with default colors
        const svg = molecule.toSVG(300, 200, undefined, {
            suppressChiralText: false,
            suppressESR: false,
            suppressCIPParity: false,
            noStereoProblem: false,
            factorTextSize: 1.0,
            strokeWidth: 1.5,
            fontWeight: 'normal',
        });

        // Clear previous content and add SVG
        targetElement.innerHTML = '';
        if (typeof svg === 'string') {
            targetElement.innerHTML = svg;
        } else {
            targetElement.appendChild(svg);
        }

        return true;
    } catch (error) {
        console.error('Error rendering SMILES preview:', error);
        targetElement.textContent = 'Error rendering SMILES';
        return false;
    }
}
