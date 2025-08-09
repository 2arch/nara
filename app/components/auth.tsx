import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, User, GoogleAuthProvider, OAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';
import React, { useState, useEffect } from 'react';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const handleSignUp = async () => {
    setError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    try {
      const provider = new OAuthProvider('apple.com');
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try {
      await auth.signOut();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div>Loading authentication...</div>;
  }

  return (
    <div className="p-8 rounded-lg shadow-md w-96">
      <h2 className="mb-6 text-center">
        {user ? `Welcome, ${user.email}` : 'Sign In / Sign Up'}
      </h2>

      {user ? (
        <div className="text-center">
          <p className="mb-4">You are logged in.</p>
          <button
            onClick={handleSignOut}
            className="w-full py-2 px-4 rounded-md hover:opacity-80 transition-colors"
          >
            Sign Out
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <label htmlFor="email" className="block text-sm mb-2">Email:</label>
            <input
              type="email"
              id="email"
              className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="mb-6">
            <label htmlFor="password" className="block text-sm mb-2">Password:</label>
            <input
              type="password"
              id="password"
              className="shadow appearance-none border rounded w-full py-2 px-3 mb-3 leading-tight focus:outline-none focus:shadow-outline"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={handleSignIn}
              className="py-2 px-4 rounded focus:outline-none focus:shadow-outline"
            >
              Sign In
            </button>
            <button
              onClick={handleSignUp}
              className="py-2 px-4 rounded focus:outline-none focus:shadow-outline"
            >
              Sign Up
            </button>
          </div>

          <div className="mt-6 space-y-4">
            <button
              onClick={handleGoogleSignIn}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline flex items-center justify-center"
            >
              <img src="/google-icon.svg" alt="Google" className="w-5 h-5 mr-2" />
              Sign in with Google
            </button>
            <button
              onClick={handleAppleSignIn}
              className="w-full bg-gray-700 hover:bg-gray-800 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline flex items-center justify-center"
            >
              <img src="/apple-icon.svg" alt="Apple" className="w-5 h-5 mr-2" />
              Sign in with Apple
            </button>
          </div>
          {error && <p className="text-xs italic mt-4 text-center">{error}</p>}
        </>
      )}
    </div>
  );
};

export default Auth;
