"use client";

import React, { useState } from 'react';

// Slideshow cards data
const slideshowCards = [
  {
    id: 1,
    title: "Truly Infinite Canvas",
    description: "No boundaries, no limits. Write anywhere in infinite space with perfect fluidity.",
    icon: "∞"
  },
  {
    id: 2,
    title: "Advanced Gesture Controls", 
    description: "Navigate with natural gestures. Pan, zoom, and interact intuitively.",
    icon: "✋"
  },
  {
    id: 3,
    title: "AI Co-pilot Mode",
    description: "Your intelligent writing companion that adapts to your thinking patterns.",
    icon: "🤖"
  },
  {
    id: 4,
    title: "Premium Features",
    description: "Unlock the full potential with unlimited AI conversations and priority support.",
    icon: "⭐"
  }
];

interface SlideshowProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export default function Slideshow({ onComplete, onSkip }: SlideshowProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showPopup, setShowPopup] = useState(false);

  const handleContinue = () => {
    if (currentSlide < slideshowCards.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      onComplete();
    }
  };

  // Handle scroll-triggered popup visibility on last slide
  React.useEffect(() => {
    if (currentSlide === slideshowCards.length - 1) {
      const handleScroll = () => {
        const scrollPosition = window.scrollY;
        const windowHeight = window.innerHeight;
        
        // Show popup when scrolled into detailed features section (past first screen)
        if (scrollPosition > windowHeight * 0.5) {
          setShowPopup(true);
        } else {
          setShowPopup(false);
        }
      };

      window.addEventListener('scroll', handleScroll);
      
      return () => {
        window.removeEventListener('scroll', handleScroll);
      };
    } else {
      setShowPopup(false);
    }
  }, [currentSlide]);

  const currentCard = slideshowCards[currentSlide];

  const isLastSlide = currentSlide === slideshowCards.length - 1;

  if (isLastSlide) {
    // Last slide - Full width with animated popup
    return (
      <div className="bg-gradient-to-br from-blue-50 to-purple-50 relative">
        {/* Skip Button */}
        {onSkip && (
          <button
            onClick={onSkip}
            className="absolute top-4 right-4 text-sm text-gray-600 hover:text-gray-800 underline hover:no-underline z-20"
          >
            Skip
          </button>
        )}

        {/* Animated Popup Header */}
        <div className={`fixed top-0 left-0 right-0 z-30 bg-white shadow-lg border-b border-gray-200 transform transition-transform duration-500 ease-out ${
          showPopup ? 'translate-y-0' : '-translate-y-full'
        }`}>
          <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">7 days free then $71.88 a year</span>
              <span className="text-green-600 font-semibold">only $6 a month</span>
            </div>
            <button
              onClick={onComplete}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-2 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-200 font-medium"
            >
              Continue
            </button>
          </div>
        </div>
        
        {/* First Screen - Two Column Layout */}
        <div className="min-h-screen flex">
          {/* Left Column - Slideshow */}
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="max-w-lg mx-auto text-center">
              {/* Progress Indicators */}
              <div className="flex justify-center space-x-2 mb-8">
                {slideshowCards.map((_, index) => (
                  <div
                    key={index}
                    className={`w-3 h-3 rounded-full transition-colors duration-300 ${
                      index <= currentSlide ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  />
                ))}
              </div>

              {/* Card */}
              <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
                <div className="text-6xl mb-6">{currentCard.icon}</div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  {currentCard.title}
                </h2>
                <p className="text-gray-600 text-lg leading-relaxed">
                  {currentCard.description}
                </p>
              </div>

              {/* Scroll Down Indicator */}
              <div className="flex flex-col items-center mt-12">
                <p className="text-sm text-gray-600 mb-2">Learn more about Nara</p>
                <div className="animate-bounce">
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - CTA Section */}
          <div className="w-96 bg-white border-l border-gray-200 p-8 flex flex-col">
            <div className="flex-1">
              {/* Pricing Card */}
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-6 text-white mb-6">
                <h3 className="text-xl font-bold mb-2">Nara Premium</h3>
                <div className="text-3xl font-bold mb-1">$71.88<span className="text-lg font-normal">/year</span></div>
                <p className="text-blue-100 text-sm">Everything you need to supercharge your intelligence</p>
              </div>

              {/* Features List */}
              <div className="space-y-3 mb-8">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-green-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-700">Unlimited AI conversations</span>
                </div>
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-green-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-700">Advanced gesture controls</span>
                </div>
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-green-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-700">Co-pilot mode</span>
                </div>
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-green-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-700">Priority support</span>
                </div>
              </div>
            </div>

            {/* Try Free Button */}
            <div className="border-t border-gray-200 pt-6">
              <button
                onClick={onComplete}
                className="w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 transition-colors duration-200 font-medium mb-3"
              >
                Try free for 7 days
              </button>
              <p className="text-xs text-gray-500 text-center">
                No commitment. Cancel anytime during trial.
              </p>
            </div>
          </div>
        </div>

        {/* Second Screen - Detailed Features Section */}
        <div className="bg-white">
          {/* Features Deep Dive */}
          <div className="max-w-6xl mx-auto py-20 px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Why Nara Changes Everything</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Traditional tools constrain your thinking. Nara removes every boundary between your ideas and their expression.
              </p>
            </div>

            {/* Feature Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
              {/* Infinite Canvas Deep Dive */}
              <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-8">
                <div className="text-4xl mb-4">∞</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Truly Infinite Space</h3>
                <p className="text-gray-600 mb-4">
                  No pages, no boundaries, no limits. Write, draw, and think across unlimited space that scales with your imagination.
                </p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Seamless zoom from macro to micro views</li>
                  <li>• Perfect text rendering at any scale</li>
                  <li>• Infinite undo/redo across entire canvas</li>
                </ul>
              </div>

              {/* Gesture Controls */}
              <div className="bg-gradient-to-br from-green-50 to-blue-50 rounded-xl p-8">
                <div className="text-4xl mb-4">✋</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Natural Gestures</h3>
                <p className="text-gray-600 mb-4">
                  Move through space as naturally as you think. Pan with precision, zoom with intention, navigate by instinct.
                </p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Multi-touch pan and zoom</li>
                  <li>• Keyboard navigation shortcuts</li>
                  <li>• Mouse wheel precision control</li>
                </ul>
              </div>

              {/* AI Co-pilot */}
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-8">
                <div className="text-4xl mb-4">🤖</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">AI That Gets You</h3>
                <p className="text-gray-600 mb-4">
                  Not just another chatbot. Nara learns your thinking patterns and becomes your intellectual companion.
                </p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Context-aware suggestions</li>
                  <li>• Adaptive writing assistance</li>
                  <li>• Pattern recognition across sessions</li>
                </ul>
              </div>

              {/* Performance */}
              <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-8">
                <div className="text-4xl mb-4">⚡</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Lightning Fast</h3>
                <p className="text-gray-600 mb-4">
                  Built for speed. Every interaction is instant, every response immediate. Your thoughts move at the speed of light.
                </p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Sub-millisecond text rendering</li>
                  <li>• Optimized for massive documents</li>
                  <li>• Real-time collaboration ready</li>
                </ul>
              </div>

              {/* Privacy */}
              <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-8">
                <div className="text-4xl mb-4">🔒</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Your Data, Your Control</h3>
                <p className="text-gray-600 mb-4">
                  End-to-end encryption ensures your thoughts remain private. Local storage options keep sensitive work secure.
                </p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• End-to-end encryption</li>
                  <li>• Local storage options</li>
                  <li>• Zero data mining policy</li>
                </ul>
              </div>

              {/* Extensibility */}
              <div className="bg-gradient-to-br from-indigo-50 to-cyan-50 rounded-xl p-8">
                <div className="text-4xl mb-4">🔧</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Infinitely Extensible</h3>
                <p className="text-gray-600 mb-4">
                  Plugin system, API access, custom integrations. Make Nara work exactly how you think.
                </p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Custom plugin development</li>
                  <li>• API for integrations</li>
                  <li>• Workflow automation tools</li>
                </ul>
              </div>
            </div>

            {/* Call to Action */}
            <div className="text-center bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-12 text-white">
              <h3 className="text-3xl font-bold mb-4">Ready to Think Without Limits?</h3>
              <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
                Join thousands of writers, researchers, and thinkers who've discovered the freedom of infinite space.
              </p>
              <button
                onClick={onComplete}
                className="bg-white text-blue-600 px-8 py-4 rounded-lg text-lg font-bold hover:bg-gray-100 transition-colors duration-200 transform hover:scale-105"
              >
                Start Your Free Trial
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // First slides - Clean slideshow only
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center relative">
      <div className="max-w-lg mx-auto text-center p-8">
        {/* Progress Indicators */}
        <div className="flex justify-center space-x-2 mb-8">
          {slideshowCards.map((_, index) => (
            <div
              key={index}
              className={`w-3 h-3 rounded-full transition-colors duration-300 ${
                index <= currentSlide ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-lg p-12 mb-8">
          <div className="text-8xl mb-8">{currentCard.icon}</div>
          <h2 className="text-3xl font-bold text-gray-900 mb-6">
            {currentCard.title}
          </h2>
          <p className="text-gray-600 text-xl leading-relaxed">
            {currentCard.description}
          </p>
        </div>

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-12 py-4 rounded-lg text-xl font-medium hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105"
        >
          Continue
        </button>
      </div>
    </div>
  );
}