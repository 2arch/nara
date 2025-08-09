"use client";

import React from 'react';
import FirebaseAuth from '../components/auth';
import StripePayment from '../components/sales';

const FunnelPage = () => {
  return (
    <div className="min-h-screen text-white flex items-center justify-center">
      <div className="flex flex-col items-center">
        <FirebaseAuth />
      </div>
    </div>
  );
};

export default FunnelPage;