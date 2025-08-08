// app/landing/Footer.tsx
import React from 'react';

// You can find high-quality SVG icons from libraries like `lucide-react` 
// or websites like Feather Icons or Heroicons. For simplicity, we'll use basic text placeholders.
// Or, for better accuracy, you can use SVG paths directly.

const XIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932L18.901 1.153zM17.61 20.644h2.039L6.486 3.24H4.298l13.312 17.404z"/>
  </svg>
);

const LinkedInIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.25 6.5 1.75 1.75 0 016.5 8.25zM19 19h-3v-4.75c0-1.4-.5-2.25-1.5-2.25S13 12.8 13 14.25V19h-3v-9h3v1.5c.5-.75 1.5-1.5 2.5-1.5s3 1.5 3 4.5z"/>
  </svg>
);

const YouTubeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M21.582,6.186C21.325,5.246,20.563,4.64,19.539,4.51C17.84,4.25,12,4.25,12,4.25s-5.84,0-7.539,0.26C3.437,4.64,2.675,5.246,2.418,6.186C2.16,7.83,2.16,12,2.16,12s0,4.17,0.258,5.814c0.257,0.94,1.019,1.546,2.043,1.676C6.16,19.75,12,19.75,12,19.75s5.84,0,7.539-0.26c1.024-0.13,1.786-0.736,2.043-1.676C21.84,16.17,21.84,12,21.84,12S21.84,7.83,21.582,6.186z M10,15.5V8.5l6,3.5L10,15.5z"/>
  </svg>
);

const InstagramIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
  </svg>
);

const DiscordIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M20.317 4.437a2.02 2.02 0 0 0-1.57-.492H5.253a2.02 2.02 0 0 0-1.57.492 21.042 21.042 0 0 0-1.898 12.032A2.05 2.05 0 0 0 3.82 18.5h12.55a1.18 1.18 0 0 0 1.12-1.013c.097-.61.32-2.28.32-2.28s.22-.16.4-.31a9.23 9.23 0 0 0 2.22-3.48.06.06 0 0 0 0-.05 9.12 9.12 0 0 0-1.12-5.464ZM8.44 13.43a1.68 1.68 0 0 1-1.74-1.68c0-.93.78-1.68 1.74-1.68s1.74.75 1.74 1.68c0 .93-.78 1.68-1.74 1.68Zm7.12 0a1.68 1.68 0 0 1-1.74-1.68c0-.93.78-1.68 1.74-1.68s1.74.75 1.74 1.68c0 .93-.78 1.68-1.74 1.68Z"/>
    </svg>
);


const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-black text-gray-400">
      <div className="container mx-auto px-6 py-12 flex justify-between items-center">
        {/* Left Side: Copyright */}
        <div>
          <p className="text-sm">&copy; {currentYear} NARA. All Rights Reserved.</p>
        </div>

        {/* Right Side: Links */}
        <div className="flex flex-col items-end gap-y-4">
          {/* Top Row: Text Links */}
          <nav>
            <ul className="flex items-center gap-x-6 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Manifesto</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Docs</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Terms</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Status</a></li>
            </ul>
          </nav>
          
          {/* Bottom Row: Social Icons */}
          <div className="flex items-center gap-x-5">
            <a href="#" className="hover:text-white transition-colors"><XIcon /></a>
            <a href="#" className="hover:text-white transition-colors"><LinkedInIcon /></a>
            <a href="#" className="hover:text-white transition-colors"><YouTubeIcon /></a>
            <a href="#" className="hover:text-white transition-colors"><InstagramIcon /></a>
            <a href="#" className="hover:text-white transition-colors"><DiscordIcon /></a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;