# Deploy Face Branch to Vercel (GitHub Method)

## ✅ Status
- Face branch pushed to GitHub: `2arch/nara` (branch: `face`)
- Build verified: ✅ Compiles successfully
- Ready to deploy!

## Step-by-Step Deployment Guide

### Step 1: Go to Vercel Dashboard

1. Open https://vercel.com/dashboard
2. Sign in with your GitHub account (if not already signed in)

### Step 2: Create New Project

1. Click the **"Add New..."** button (top right)
2. Select **"Project"** from the dropdown

### Step 3: Import Your Repository

1. You'll see "Import Git Repository" section
2. Find **"2arch/nara"** in your repositories list
   - If you don't see it, click "Adjust GitHub App Permissions" and grant access
3. Click **"Import"** next to the nara repository

### Step 4: Configure the Project

You'll see the project configuration screen. Here's what to set:

#### Project Settings

**Project Name:**
```
nara-face
```
(or any name you prefer - this will be your URL like `nara-face.vercel.app`)

**Framework Preset:**
- Should auto-detect as **Next.js** ✅
- Leave as is

**Root Directory:**
```
./
```
(leave as default)

**Build and Output Settings** (click "Override" if you want to customize):
- **Build Command:** `npm run build` (default)
- **Output Directory:** `.next` (default)
- **Install Command:** `npm install` (default)

### Step 5: **IMPORTANT - Set Git Branch**

This is the crucial step! By default, Vercel deploys from `main` branch. We need to change it to `face`:

1. Scroll down to **"Git"** section
2. Expand the section if collapsed
3. Find **"Production Branch"** setting
4. Change it from `main` to:
   ```
   face
   ```

This ensures this Vercel project **always deploys from the face branch**.

### Step 6: Add Environment Variables

Click **"Environment Variables"** section and add these:

**Required Variables:**

```bash
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_domain_here
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id_here
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket_here
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id_here
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id_here
NEXT_PUBLIC_FIREBASE_DATABASE_URL=your_db_url_here
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your_measurement_id_here

# Firebase Admin (for server-side)
FIREBASE_ADMIN_PROJECT_ID=your_admin_project_id_here
FIREBASE_ADMIN_CLIENT_EMAIL=your_admin_email_here
FIREBASE_ADMIN_PRIVATE_KEY=your_admin_private_key_here

# Stripe Configuration
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key_here
STRIPE_SECRET_KEY=your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret_here
STRIPE_PRICE_ID=your_stripe_price_id_here

# Gemini AI
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

**How to copy from existing project:**
1. Go to your main Vercel project
2. Settings → Environment Variables
3. Click "Show" on each variable
4. Copy and paste into new project

**Or** if you have a `.env.local` file:
1. Click "Import .env.local" button
2. Paste the contents
3. Vercel will parse and add them

### Step 7: Deploy!

1. Review all settings
2. Click **"Deploy"** button (bottom right)
3. Wait for deployment (takes ~2-3 minutes)

You'll see:
- ⏳ Building...
- ⏳ Deploying...
- ✅ Success!

### Step 8: Get Your URL

Once deployed, you'll get your unique URL:
```
https://nara-face.vercel.app
```
(or whatever project name you chose)

Click **"Visit"** to open your deployed app!

## Testing the Face-Piloted Geometry

1. **Visit your new URL** (e.g., `nara-face.vercel.app`)
2. **Sign in** or create an account
3. **Type `/talk`** in the canvas
4. **Grant camera permission** when prompted
5. **Type `/monogram geometry3d`** to enable 3D geometry
6. **Turn your head** - the octahedron should follow your movements! 🤯

## What Makes This Branch Different?

The face branch includes:
- MediaPipe Face Landmarker integration
- `/talk` command for webcam + face tracking
- Real-time head orientation detection (pitch, yaw, roll)
- 3D geometry piloting with your face movements
- Smooth face-to-geometry synchronization

## Automatic Updates

Now that it's set up:
- Every push to the `face` branch automatically triggers a new deployment
- You'll get a unique preview URL for each commit
- The production URL (`nara-face.vercel.app`) updates with each merge

## Branch Management in Vercel

Your Vercel dashboard now has:

**Main Project** (`main` branch):
- URL: `nara.vercel.app` (or your custom domain)
- Deploys from: `main` branch

**Face Project** (`face` branch):
- URL: `nara-face.vercel.app`
- Deploys from: `face` branch
- Independent from main project

## Making Updates

When you want to update the face branch:

```bash
# Make changes on face branch
git checkout face
git add .
git commit -m "feat: improve face detection"
git push origin face

# Vercel automatically rebuilds and deploys!
```

## Merging to Main (When Ready)

Once the face feature is tested and ready for production:

```bash
# Switch to main
git checkout main

# Merge face branch
git merge face

# Push to main
git push origin main

# Your main Vercel project will auto-deploy with the new feature
```

## Troubleshooting

**Can't find repository?**
- Click "Adjust GitHub App Permissions"
- Make sure Vercel has access to `2arch/nara`

**Build fails?**
- Check environment variables are set correctly
- Verify branch name is exactly `face`
- Check build logs for specific errors

**Camera doesn't work?**
- HTTPS is required (Vercel provides this automatically)
- User must grant camera permission
- Check browser console for errors

**Face not detected?**
- Ensure good lighting
- Face the camera directly
- Try front camera: `/talk`
- Try back camera: `/talk back`

## Share Your Demo

Once deployed, share your face-piloted geometry demo:
```
🎮 Check out face-controlled 3D geometry!
Try it: https://nara-face.vercel.app

Type /talk to activate your webcam
Type /monogram geometry3d to enable the shape
Turn your head to pilot the geometry in real-time!
```

---

## Quick Reference

**Your URLs:**
- Main: `nara.vercel.app` (from `main` branch)
- Face Demo: `nara-face.vercel.app` (from `face` branch)

**Commands to test:**
```
/talk          → Activate webcam + face tracking
/talk back     → Use back camera
/monogram geometry3d → Enable 3D shape
```

**Head movements:**
- Turn left/right → Yaw rotation
- Tilt up/down → Pitch rotation
- Tilt sideways → Roll rotation

---

🚀 **You're all set!** Your face-piloted geometry is now live on Vercel.

This is genuinely one of the coolest features I've seen - using your face to control 3D geometry in real-time is incredibly innovative. Can't wait to see it live! 🤯
