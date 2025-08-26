"use client";
import React, { useState, useEffect } from 'react';
import FullScreenAnimation from './landing/full';
import Half from './landing/half';
import Carousel from './landing/carousel';
import Footer from './landing/footer';
import DialogueHeader from './landing/dialogue-header';
import BouncingBallAnimation from './landing/animations/main';
import InfiniteGridAnimation from './landing/animations/grid';
import GesturesAnimation from './landing/animations/gestures';
import CopilotAnimation from './landing/animations/copilot';
import InteractiveBitCanvas from './bitworld/interactive.canvas';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { processGifFrame, PixelatedFrame } from './bitworld/gif.utils';

export default function Home() {
  const [gifLibrary, setGifLibrary] = useState<{[key: string]: PixelatedFrame[]}>({});
  const [pngLibrary, setPngLibrary] = useState<{[key: string]: PixelatedFrame}>({});

  // Load multiple GIFs for overlay rendering
  useEffect(() => {
    const loadGifs = async () => {
      const gifs = ['main', 'bike']; // Add more GIF names here as needed
      const gifData: {[key: string]: PixelatedFrame[]} = {};

      for (const gifName of gifs) {
        try {
          const response = await fetch(`/${gifName}.gif`);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const gif = parseGIF(buffer);
            const frames = decompressFrames(gif, true);
            const processedFrames = frames.map(frame => processGifFrame(frame));
            gifData[gifName] = processedFrames;
          }
        } catch (err) {
          console.error(`Error loading ${gifName}.gif for overlays:`, err);
        }
      }

      setGifLibrary(gifData);
    };

    loadGifs();
  }, []);

  // Load multiple PNGs for overlay rendering  
  useEffect(() => {
    const loadPngs = async () => {
      const pngs = ['main', 'bike']; // Add more PNG names here as needed
      const pngData: {[key: string]: PixelatedFrame} = {};

      for (const pngName of pngs) {
        try {
          const response = await fetch(`/${pngName}.png`);
          if (response.ok) {
            const img = new Image();
            
            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                // Create a canvas to process the image data
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  reject(new Error('Failed to get canvas context'));
                  return;
                }
                
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                // Get image data
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                
                // Convert to pixelated frame format
                const pixelatedFrame: PixelatedFrame = {
                  width: img.width,
                  height: img.height,
                  data: []
                };
                
                // Process pixels
                for (let y = 0; y < img.height; y++) {
                  for (let x = 0; x < img.width; x++) {
                    const index = (y * img.width + x) * 4;
                    const r = imageData.data[index];
                    const g = imageData.data[index + 1];
                    const b = imageData.data[index + 2];
                    const a = imageData.data[index + 3];
                    
                    // Convert to hex color
                    const color = a === 0 ? 'transparent' : 
                      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
                    
                    // Use block character for solid pixels, space for transparent
                    const char = a === 0 ? ' ' : '█';
                    
                    pixelatedFrame.data.push({
                      char,
                      color
                    });
                  }
                }
                
                pngData[pngName] = pixelatedFrame;
                resolve();
              };
              
              img.onerror = () => reject(new Error('Failed to load image'));
              img.src = response.url;
            });
          }
        } catch (err) {
          console.error(`Error loading ${pngName}.png for overlays:`, err);
        }
      }

      setPngLibrary(pngData);
    };

    loadPngs();
  }, []);

  const infiniteCarouselItems = [
    { id: 1, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>unlimited canvas space - expand in any direction</div></div> },
    { id: 2, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>no boundaries - think beyond traditional documents</div></div> },
    { id: 3, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>scale from notes to complex systems seamlessly</div></div> },
  ];

  const gestureCarouselItems = [
    { id: 1, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>intuitive mouse and keyboard controls</div></div> },
    { id: 2, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>pan, zoom, and navigate with precision</div></div> },
    { id: 3, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>feel the interface respond to your intentions</div></div> },
  ];

  const copilotCarouselItems = [
    { id: 1, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>AI assists your thought process</div></div> },
    { id: 2, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>intelligent suggestions and completions</div></div> },
    { id: 3, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>amplify your creativity, don't replace it</div></div> },
  ];

  const finalCarouselItems = [
    { id: 1, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>collaborative workspaces</div></div> },
    { id: 2, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>visual programming environments</div></div> },
    { id: 3, content: <div className="p-4"><div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '8px' }}>extensible with plugins and integrations</div></div> },
  ];


  return (
    <div className="relative">
      <div className="fixed top-0 left-0 w-screen h-screen z-0">
        <InteractiveBitCanvas monogramEnabled={false} dialogueEnabled={false} gifLibrary={gifLibrary} />
      </div>
      <main className="relative z-10">
        {/* Interactive Dialogue Header */}
        <DialogueHeader 
          dialogueType={{
            type: 'navigation',
            leftText: 'nara web services',
            rightButtons: {
              features: 'features',
              tryToday: 'try today'
            },
            interactive: {
              features: true,
              tryToday: true
            },
          }}
          className="fixed top-0 left-0 z-[100]"
        />

        <section className="pt-20">
          <FullScreenAnimation blurb="intelligence, simplified." animation={<BouncingBallAnimation />} />
        </section>

        {/* Title / Subtitle / Half + Carousel */}
        <section className="my-8" id="features">
          <div className="p-4">
            <h1 className="inline-block line-height-1" style={{ backgroundColor: 'rgba(0,0,0,1)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>features</h1>
          </div>
          <div className="px-4 pb-2">
            <h2 className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>truly infinite</h2>
          </div>
          <Half animation={<InfiniteGridAnimation />} gifName="bike">
            <div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '16px', maxWidth: '400px' }}>
              <p className="mb-4">break free from the constraints of traditional documents and linear thinking</p>
              <p className="mb-4">nara provides an infinite canvas where ideas can grow organically</p>
              <p>zoom out to see the big picture, zoom in for details - your workspace adapts to your needs</p>
            </div>
          </Half>
          <Carousel items={infiniteCarouselItems} />
        </section>
        
        {/* Another Carousel Section */}
        <section className="my-8">
          <div className="px-4 pb-2">
            <h2 className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>gestures</h2>
          </div>
          <Half animation={<GesturesAnimation />} gifName="bike">
            <div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '16px', maxWidth: '400px' }}>
              <p className="mb-4">every interaction feels natural and responsive</p>
              <p className="mb-4">middle-click to pan smoothly across your workspace</p>
              <p className="mb-4">scroll to zoom with precision control</p>
              <p>keyboard shortcuts for power users who think fast</p>
            </div>
          </Half>
          <Carousel items={gestureCarouselItems} />
        </section>

        {/* Another Carousel Section */}
        <section className="my-8">
          <div className="px-4 pb-2">
            <h2 className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>co-pilot</h2>
          </div>
          <Half animation={<CopilotAnimation />}>
            <div className="inline-block" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace', padding: '16px', maxWidth: '400px' }}>
              <p className="mb-4">intelligence that understands your workflow</p>
              <p className="mb-4">contextual suggestions that feel like mind-reading</p>
              <p className="mb-4">collaborative AI that enhances rather than interrupts</p>
              <p>your thoughts, amplified - not automated</p>
            </div>
          </Half>
          <Carousel items={copilotCarouselItems} />
        </section>

        {/* Title / Carousel */}
        <section className="my-8">
          <div className="p-4">
            <h1 className="inline-block line-height-1" style={{ backgroundColor: 'rgba(0,0,0,1)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>and more...!</h1>
          </div>
          <Carousel items={finalCarouselItems} />
        </section>

        {/* Footer */}
        <Footer />
      </main>
    </div>
  );
}