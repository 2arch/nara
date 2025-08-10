// app/landing/Footer.tsx
import React from 'react';

const Footer = () => {
  return (
    <footer className="bg-black text-gray-400">
      <div className="container mx-auto px-6 py-12 flex justify-center items-center">
        {/* Centered Copyright */}
        <div>
          <p className="text-sm">&copy; 2025 Nara Web Services. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;