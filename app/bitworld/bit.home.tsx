// components/BitHomeCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { WorldEngine } from './world.engine';
import { useMonogramSystem } from './monogram';
import { signUpUser, signInUser, checkUsernameAvailability, getUsernameByUid } from '../firebase';
import { logger } from './logger';

// --- Constants ---
const CURSOR_COLOR_PRIMARY = '#0066FF';
const CURSOR_COLOR_SECONDARY = '#FF6B35';

interface BitHomeCanvasProps {
    engine: WorldEngine;
    cursorColorAlternate: boolean;
    className?: string;
    monogramEnabled?: boolean;
    showForm?: boolean;
    isSignup?: boolean;
    taglineText?: { title: string; subtitle: string };
    navButtons?: { 
        onLoginClick?: () => void; 
        onSignupClick?: () => void;
        onVisitClick?: () => void;
        isAuthenticated?: boolean; 
    };
    onBackClick?: () => void;
    onAuthSuccess?: (username: string) => void;
    fontFamily?: string;
}

export function BitHomeCanvas({ engine, cursorColorAlternate, className, monogramEnabled = false, showForm = false, isSignup = false, taglineText, navButtons, onBackClick, onAuthSuccess, fontFamily = 'IBM Plex Mono' }: BitHomeCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const devicePixelRatioRef = useRef(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    
    // === Form State (Dialogue-style) ===
    const [focusedInput, setFocusedInput] = useState<'firstName' | 'lastName' | 'email' | 'password' | 'username' | null>(null);
    const [pressedButton, setPressedButton] = useState<string | null>(null);
    const [pressedNavButton, setPressedNavButton] = useState<string | null>(null);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [signupStep, setSignupStep] = useState<1 | 2>(1); // Two-step signup process
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [formState, setFormState] = useState({
        firstName: { value: '', cursorPos: 0 },
        lastName: { value: '', cursorPos: 0 },
        email: { value: '', cursorPos: 0 },
        password: { value: '', cursorPos: 0 },
        username: { value: '', cursorPos: 0 }
    });
    
    // === Form Submission Handlers ===
    const handleSignupSubmit = useCallback(async () => {
        const { firstName, lastName, email, password, username } = formState;
        
        // Basic validation
        if (!firstName.value.trim() || !lastName.value.trim() || !email.value.trim() || !password.value.trim() || !username.value.trim()) {
            setSubmitError('Please fill in all fields');
            return;
        }
        
        if (password.value.length < 6) {
            setSubmitError('Password must be at least 6 characters');
            return;
        }
        
        setIsSubmitting(true);
        setSubmitError(null);
        
        try {
            // Check username availability first
            const isUsernameAvailable = await checkUsernameAvailability(username.value);
            if (!isUsernameAvailable) {
                setSubmitError('Username is already taken');
                setIsSubmitting(false);
                return;
            }
            
            // Create the user account
            const result = await signUpUser(
                email.value.trim(),
                password.value,
                firstName.value.trim(),
                lastName.value.trim(),
                username.value.trim()
            );
            
            if (result.success) {
                setSubmitSuccess(true);
                // Navigate to user's homepage
                if (onAuthSuccess) {
                    onAuthSuccess(username.value.trim());
                }
            } else {
                setSubmitError(result.error || 'Failed to create account');
            }
        } catch (error) {
            logger.error('Signup error:', error);
            setSubmitError('An unexpected error occurred');
        } finally {
            setIsSubmitting(false);
        }
    }, [formState]);
    
    const handleLoginSubmit = useCallback(async () => {
        const { email, password } = formState;
        
        if (!email.value.trim() || !password.value.trim()) {
            setSubmitError('Please fill in both email and password');
            return;
        }
        
        setIsSubmitting(true);
        setSubmitError(null);
        
        try {
            const result = await signInUser(email.value.trim(), password.value);
            
            if (result.success && result.user) {
                setSubmitSuccess(true);
                // Get username and navigate to user's homepage
                const username = await getUsernameByUid(result.user.uid);
                if (username && onAuthSuccess) {
                    onAuthSuccess(username);
                } else if (onAuthSuccess) {
                    // Fallback to UID if username not found
                    onAuthSuccess(result.user.uid);
                }
            } else {
                setSubmitError(result.error || 'Failed to sign in');
            }
        } catch (error) {
            logger.error('Login error:', error);
            setSubmitError('An unexpected error occurred');
        } finally {
            setIsSubmitting(false);
        }
    }, [formState]);
    
    // === Monogram System (Hard-coded 'nara' pattern) ===
    const monogramSystem = useMonogramSystem({
        mode: 'nara',
        speed: 0.5,
        complexity: 1.0,
        colorShift: 0.5,
        enabled: true,
        renderScheme: 'point-based',
        geometryType: 'octahedron',
        interactiveTrails: true,
        trailIntensity: 0.5,
        trailFadeMs: 500,
        maskName: 'macintosh',
    });
    
    // === Form Layout Calculation (Dialogue.tsx pattern) ===
    const calculateFormLayout = useCallback((canvasWidth: number, canvasHeight: number) => {
        const charHeight = 16; // Fixed font size like dialogue
        const charWidth = 16 * 0.6; // Fixed character width ratio
        
        // Responsive form dimensions
        const baseInputWidth = canvasWidth < 768 ? 20 : 30;
        const passwordInputWidth = baseInputWidth - 5;
        const toggleButtonWidth = 4;
        const gapWidth = 1.4; // Space between password input and toggle button
        const buttonWidth = canvasWidth < 768 ? 10 : 15;
        const spacing = 2;
        
        // Make email input same width as password row (password + gap + toggle)
        const emailInputWidth = passwordInputWidth + gapWidth + toggleButtonWidth;
        const rowWidth = emailInputWidth; // Both rows will be this width
        
        // Name inputs (for signup) - half width each with gap
        const nameInputWidth = Math.floor((emailInputWidth - gapWidth) / 2);
        
        // Center everything in viewport (dialogue pattern)
        const backButtonWidth = 4; // 'back' button width
        const formHeight = isSignup ? (signupStep === 1 ? 8 : 4) : 6; // Different heights for each step
        const centerX = Math.floor(canvasWidth / 2);
        const centerY = Math.floor(canvasHeight / 2);
        
        if (isSignup && signupStep === 1) {
            // Signup Step 1: back, firstName+lastName, email, password+toggle, "Next" button
            return {
                charWidth,
                charHeight,
                fields: {
                    back: {
                        x: centerX - (emailInputWidth * charWidth) / 2,
                        y: centerY - (formHeight * charHeight) / 2,
                        width: backButtonWidth
                    },
                    firstName: {
                        x: centerX - (emailInputWidth * charWidth) / 2,
                        y: centerY - (formHeight * charHeight) / 2 + spacing * charHeight,
                        width: nameInputWidth
                    },
                    lastName: {
                        x: centerX - (emailInputWidth * charWidth) / 2 + (nameInputWidth + gapWidth) * charWidth,
                        y: centerY - (formHeight * charHeight) / 2 + spacing * charHeight,
                        width: nameInputWidth
                    },
                    email: { 
                        x: centerX - (emailInputWidth * charWidth) / 2, 
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 2) * charHeight, 
                        width: emailInputWidth 
                    },
                    password: { 
                        x: centerX - (emailInputWidth * charWidth) / 2, 
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 3) * charHeight, 
                        width: passwordInputWidth 
                    },
                    toggle: {
                        x: centerX - (emailInputWidth * charWidth) / 2 + (passwordInputWidth + gapWidth) * charWidth,
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 3) * charHeight,
                        width: toggleButtonWidth
                    },
                    button: { 
                        x: centerX - (buttonWidth * charWidth) / 2, 
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 4) * charHeight, 
                        width: buttonWidth 
                    }
                }
            };
        } else if (isSignup && signupStep === 2) {
            // Signup Step 2: back, username, "Sign Up" button
            return {
                charWidth,
                charHeight,
                fields: {
                    back: {
                        x: centerX - (emailInputWidth * charWidth) / 2,
                        y: centerY - (formHeight * charHeight) / 2,
                        width: backButtonWidth
                    },
                    username: {
                        x: centerX - (emailInputWidth * charWidth) / 2,
                        y: centerY - (formHeight * charHeight) / 2 + spacing * charHeight,
                        width: emailInputWidth
                    },
                    button: { 
                        x: centerX - (buttonWidth * charWidth) / 2, 
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 2) * charHeight, 
                        width: buttonWidth 
                    }
                }
            };
        } else {
            // Login form layout: back, email, password+toggle, button
            return {
                charWidth,
                charHeight,
                fields: {
                    back: {
                        x: centerX - (emailInputWidth * charWidth) / 2,
                        y: centerY - (formHeight * charHeight) / 2,
                        width: backButtonWidth
                    },
                    email: { 
                        x: centerX - (emailInputWidth * charWidth) / 2, 
                        y: centerY - (formHeight * charHeight) / 2 + spacing * charHeight, 
                        width: emailInputWidth 
                    },
                    password: { 
                        x: centerX - (emailInputWidth * charWidth) / 2, 
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 2) * charHeight, 
                        width: passwordInputWidth 
                    },
                    toggle: {
                        x: centerX - (emailInputWidth * charWidth) / 2 + (passwordInputWidth + gapWidth) * charWidth,
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 2) * charHeight,
                        width: toggleButtonWidth
                    },
                    button: { 
                        x: centerX - (buttonWidth * charWidth) / 2, 
                        y: centerY - (formHeight * charHeight) / 2 + (spacing * 3) * charHeight, 
                        width: buttonWidth 
                    }
                }
            };
        }
    }, [isSignup, signupStep]);
    
    // === Form Rendering Function (Dialogue.tsx pattern) ===
    const renderForm = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
        const layout = calculateFormLayout(canvasWidth, canvasHeight);
        const verticalTextOffset = (layout.charHeight - 16) / 2 + (16 * 0.1);
        
        ctx.save();
        ctx.font = `16px "${fontFamily}"`;
        ctx.textBaseline = 'top';
        
        // Track clickable regions (dialogue pattern)
        const clickableRegions: Array<{type: 'back' | 'firstName' | 'lastName' | 'email' | 'password' | 'toggle' | 'username' | 'button', rect: {x: number, y: number, width: number, height: number}}> = [];
        
        // === Render Back Button ===
        const backField = layout.fields.back;
        const backText = 'back';
        
        ctx.fillStyle = pressedButton === 'back' ? '#333333' : '#000000';
        ctx.fillRect(backField.x, backField.y, backField.width * layout.charWidth, layout.charHeight);
        
        ctx.fillStyle = '#FFFFFF';
        const backTextX = backField.x + ((backField.width * layout.charWidth) - (backText.length * layout.charWidth)) / 2;
        ctx.fillText(backText, backTextX, backField.y + verticalTextOffset);
        
        clickableRegions.push({
            type: 'back',
            rect: { x: backField.x, y: backField.y, width: backField.width * layout.charWidth, height: layout.charHeight }
        });
        
        // === Render Name Fields (Signup Step 1 only) ===
        if (isSignup && signupStep === 1 && layout.fields.firstName && layout.fields.lastName) {
            // First Name Field
            const firstNameField = layout.fields.firstName;
            const firstNameValue = formState.firstName.value || 'first name';
            const firstNameFocused = focusedInput === 'firstName';
            
            ctx.fillStyle = firstNameFocused ? '#E3F2FD' : '#F5F5F5';
            ctx.fillRect(firstNameField.x, firstNameField.y, firstNameField.width * layout.charWidth, layout.charHeight);
            
            ctx.strokeStyle = firstNameFocused ? '#2196F3' : '#000000';
            ctx.strokeRect(firstNameField.x - 1, firstNameField.y - 1, firstNameField.width * layout.charWidth + 2, layout.charHeight + 2);
            
            ctx.fillStyle = formState.firstName.value ? '#000000' : '#888888';
            const firstNameDisplayText = firstNameValue.substring(0, firstNameField.width - 2);
            ctx.fillText(firstNameDisplayText, firstNameField.x + 4, firstNameField.y + verticalTextOffset);
            
            // First Name cursor
            if (firstNameFocused && cursorColorAlternate) {
                const cursorX = firstNameField.x + 4 + Math.min(formState.firstName.cursorPos, firstNameDisplayText.length) * layout.charWidth;
                ctx.fillStyle = '#0066FF';
                ctx.fillRect(cursorX, firstNameField.y + 2, 2, layout.charHeight - 4);
            }
            
            clickableRegions.push({
                type: 'firstName',
                rect: { x: firstNameField.x, y: firstNameField.y, width: firstNameField.width * layout.charWidth, height: layout.charHeight }
            });
            
            // Last Name Field
            const lastNameField = layout.fields.lastName;
            const lastNameValue = formState.lastName.value || 'last name';
            const lastNameFocused = focusedInput === 'lastName';
            
            ctx.fillStyle = lastNameFocused ? '#E3F2FD' : '#F5F5F5';
            ctx.fillRect(lastNameField.x, lastNameField.y, lastNameField.width * layout.charWidth, layout.charHeight);
            
            ctx.strokeStyle = lastNameFocused ? '#2196F3' : '#000000';
            ctx.strokeRect(lastNameField.x - 1, lastNameField.y - 1, lastNameField.width * layout.charWidth + 2, layout.charHeight + 2);
            
            ctx.fillStyle = formState.lastName.value ? '#000000' : '#888888';
            const lastNameDisplayText = lastNameValue.substring(0, lastNameField.width - 2);
            ctx.fillText(lastNameDisplayText, lastNameField.x + 4, lastNameField.y + verticalTextOffset);
            
            // Last Name cursor
            if (lastNameFocused && cursorColorAlternate) {
                const cursorX = lastNameField.x + 4 + Math.min(formState.lastName.cursorPos, lastNameDisplayText.length) * layout.charWidth;
                ctx.fillStyle = '#0066FF';
                ctx.fillRect(cursorX, lastNameField.y + 2, 2, layout.charHeight - 4);
            }
            
            clickableRegions.push({
                type: 'lastName',
                rect: { x: lastNameField.x, y: lastNameField.y, width: lastNameField.width * layout.charWidth, height: layout.charHeight }
            });
        }
        
        // === Render Email Field (Login or Signup Step 1) ===
        if ((!isSignup) || (isSignup && signupStep === 1)) {
            const emailField = layout.fields.email;
            if (!emailField) return; // Safety check
            const emailValue = formState.email.value || 'enter your email';
            const emailFocused = focusedInput === 'email';
        
        ctx.fillStyle = emailFocused ? '#E3F2FD' : '#F5F5F5';
        ctx.fillRect(emailField.x, emailField.y, emailField.width * layout.charWidth, layout.charHeight);
        
        ctx.strokeStyle = emailFocused ? '#2196F3' : '#000000';
        ctx.strokeRect(emailField.x - 1, emailField.y - 1, emailField.width * layout.charWidth + 2, layout.charHeight + 2);
        
        ctx.fillStyle = formState.email.value ? '#000000' : '#888888';
        const emailDisplayText = emailValue.substring(0, emailField.width - 2);
        ctx.fillText(emailDisplayText, emailField.x + 4, emailField.y + verticalTextOffset);
        
        // Email cursor
        if (emailFocused && cursorColorAlternate) {
            const cursorX = emailField.x + 4 + Math.min(formState.email.cursorPos, emailDisplayText.length) * layout.charWidth;
            ctx.fillStyle = '#0066FF';
            ctx.fillRect(cursorX, emailField.y + 2, 2, layout.charHeight - 4);
        }
        
        clickableRegions.push({
            type: 'email',
            rect: { x: emailField.x, y: emailField.y, width: emailField.width * layout.charWidth, height: layout.charHeight }
        });
        }
        
        // === Render Password Field (Login or Signup Step 1 only) ===
        if ((!isSignup) || (isSignup && signupStep === 1)) {
            const passwordField = layout.fields.password;
            if (!passwordField) return; // Safety check
            const passwordValue = formState.password.value || 'enter your password';
            const passwordDisplay = (formState.password.value && !passwordVisible) ? '•'.repeat(formState.password.value.length) : passwordValue;
            const passwordFocused = focusedInput === 'password';
            
            ctx.fillStyle = passwordFocused ? '#E3F2FD' : '#F5F5F5';
            ctx.fillRect(passwordField.x, passwordField.y, passwordField.width * layout.charWidth, layout.charHeight);
            
            ctx.strokeStyle = passwordFocused ? '#2196F3' : '#000000';
            ctx.strokeRect(passwordField.x - 1, passwordField.y - 1, passwordField.width * layout.charWidth + 2, layout.charHeight + 2);
            
            ctx.fillStyle = formState.password.value ? '#000000' : '#888888';
            const passwordDisplayText = passwordDisplay.substring(0, passwordField.width - 2);
            ctx.fillText(passwordDisplayText, passwordField.x + 4, passwordField.y + verticalTextOffset);
            
            // Password cursor
            if (passwordFocused && cursorColorAlternate) {
                const cursorX = passwordField.x + 4 + Math.min(formState.password.cursorPos, passwordDisplayText.length) * layout.charWidth;
                ctx.fillStyle = '#0066FF';
                ctx.fillRect(cursorX, passwordField.y + 2, 2, layout.charHeight - 4);
            }
            
            clickableRegions.push({
                type: 'password',
                rect: { x: passwordField.x, y: passwordField.y, width: passwordField.width * layout.charWidth, height: layout.charHeight }
            });
            
            // === Render Toggle Button ===
            const toggleField = layout.fields.toggle;
            const toggleText = passwordVisible ? 'hide' : 'show';
            
            ctx.fillStyle = pressedButton === 'toggle' ? '#333333' : '#000000';
            ctx.fillRect(toggleField.x, toggleField.y, toggleField.width * layout.charWidth, layout.charHeight);
            
            ctx.fillStyle = '#FFFFFF';
            const toggleTextX = toggleField.x + ((toggleField.width * layout.charWidth) - (toggleText.length * layout.charWidth)) / 2;
            ctx.fillText(toggleText, toggleTextX, toggleField.y + verticalTextOffset);
            
            clickableRegions.push({
                type: 'toggle',
                rect: { x: toggleField.x, y: toggleField.y, width: toggleField.width * layout.charWidth, height: layout.charHeight }
            });
        }
        
        // === Render Username Field (Signup Step 2 only) ===
        if (isSignup && signupStep === 2 && layout.fields.username) {
            const usernameField = layout.fields.username;
            const usernameValue = formState.username.value;
            const usernameDisplay = usernameValue ? `@${usernameValue}` : '@username';
            const usernameFocused = focusedInput === 'username';
            
            ctx.fillStyle = usernameFocused ? '#E3F2FD' : '#F5F5F5';
            ctx.fillRect(usernameField.x, usernameField.y, usernameField.width * layout.charWidth, layout.charHeight);
            
            ctx.strokeStyle = usernameFocused ? '#2196F3' : '#000000';
            ctx.strokeRect(usernameField.x - 1, usernameField.y - 1, usernameField.width * layout.charWidth + 2, layout.charHeight + 2);
            
            // Render @ symbol in gray, then username
            const atSymbol = '@';
            ctx.fillStyle = '#888888'; // Gray @ symbol
            ctx.fillText(atSymbol, usernameField.x + 4, usernameField.y + verticalTextOffset);
            
            // Render username part
            if (usernameValue) {
                ctx.fillStyle = '#000000';
                ctx.fillText(usernameValue, usernameField.x + 4 + layout.charWidth, usernameField.y + verticalTextOffset);
            } else {
                ctx.fillStyle = '#888888';
                ctx.fillText('username', usernameField.x + 4 + layout.charWidth, usernameField.y + verticalTextOffset);
            }
            
            // Username cursor (positioned after the @ symbol)
            if (usernameFocused && cursorColorAlternate) {
                const cursorX = usernameField.x + 4 + layout.charWidth + Math.min(formState.username.cursorPos, usernameValue.length) * layout.charWidth;
                ctx.fillStyle = '#0066FF';
                ctx.fillRect(cursorX, usernameField.y + 2, 2, layout.charHeight - 4);
            }
            
            clickableRegions.push({
                type: 'username',
                rect: { x: usernameField.x, y: usernameField.y, width: usernameField.width * layout.charWidth, height: layout.charHeight }
            });
        }
        
        // === Render Submit Button ===
        const buttonField = layout.fields.button;
        let buttonText = '';
        if (isSubmitting) {
            buttonText = 'loading...';
        } else if (submitSuccess) {
            buttonText = 'success!';
        } else if (isSignup) {
            buttonText = signupStep === 1 ? 'next' : 'sign up';
        } else {
            buttonText = 'log in';
        }
        
        ctx.fillStyle = pressedButton === 'signup' ? '#333333' : '#000000';
        ctx.fillRect(buttonField.x, buttonField.y, buttonField.width * layout.charWidth, layout.charHeight);
        
        ctx.fillStyle = '#FFFFFF';
        const buttonTextX = buttonField.x + ((buttonField.width * layout.charWidth) - (buttonText.length * layout.charWidth)) / 2;
        ctx.fillText(buttonText, buttonTextX, buttonField.y + verticalTextOffset);
        
        clickableRegions.push({
            type: 'button',
            rect: { x: buttonField.x, y: buttonField.y, width: buttonField.width * layout.charWidth, height: layout.charHeight }
        });
        
        // === Render Error Message ===
        if (submitError) {
            const errorY = buttonField.y + layout.charHeight + 10; // Below the button
            ctx.fillStyle = '#FF0000'; // Red error text
            ctx.font = `14px "${fontFamily}"`; // Slightly smaller font
            const errorText = submitError;
            const errorX = buttonField.x + ((buttonField.width * layout.charWidth) - (errorText.length * (layout.charWidth * 0.9))) / 2; // Center error text
            ctx.fillText(errorText, errorX, errorY);
        }
        
        // === Render Success Message ===
        if (submitSuccess) {
            const successY = buttonField.y + layout.charHeight + 10; // Below the button
            ctx.fillStyle = '#00AA00'; // Green success text
            ctx.font = `14px "${fontFamily}"`; // Slightly smaller font
            const successText = isSignup ? 'Account created successfully!' : 'Signed in successfully!';
            const successX = buttonField.x + ((buttonField.width * layout.charWidth) - (successText.length * (layout.charWidth * 0.9))) / 2; // Center success text
            ctx.fillText(successText, successX, successY);
        }
        
        // Store regions for click handling (dialogue pattern)
        (ctx.canvas as any).formClickableRegions = clickableRegions;
        
        ctx.restore();
    }, [formState, passwordVisible, cursorColorAlternate, pressedButton, focusedInput, calculateFormLayout, isSignup, signupStep, isSubmitting, submitError, submitSuccess]);

    // === Tagline Rendering Function (Dialogue.tsx pattern) ===
    const renderTagline = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
        if (!taglineText) return;
        
        const charHeight = 16; // Fixed font size like dialogue
        const charWidth = 16 * 0.6; // Fixed character width ratio
        const verticalTextOffset = (charHeight - 16) / 2 + (16 * 0.1);
        const leftMargin = 40; // Left margin in pixels
        
        // Center vertically, left-aligned with margin
        const centerY = Math.floor(canvasHeight / 2);
        
        const titleX = leftMargin;
        const titleY = centerY - charHeight; // Title above center
        
        const subtitleX = leftMargin;
        const subtitleY = centerY + charHeight; // Subtitle below center
        
        ctx.save();
        ctx.font = `16px "${fontFamily}"`;
        ctx.textBaseline = 'top';
        
        // Draw black background for title
        const titleWidth = taglineText.title.length * charWidth;
        ctx.fillStyle = '#000000';
        ctx.fillRect(titleX, titleY, titleWidth, charHeight);
        
        // Draw black background for subtitle
        const subtitleWidth = taglineText.subtitle.length * charWidth;
        ctx.fillStyle = '#000000';
        ctx.fillRect(subtitleX, subtitleY, subtitleWidth, charHeight);
        
        // Draw white text
        ctx.fillStyle = '#FFFFFF';
        
        // Render title
        ctx.fillText(taglineText.title, titleX, titleY + verticalTextOffset);
        
        // Render subtitle
        ctx.fillText(taglineText.subtitle, subtitleX, subtitleY + verticalTextOffset);
        
        ctx.restore();
    }, [taglineText]);

    // === Navigation Buttons Rendering Function (Dialogue.tsx pattern) ===
    const renderNavButtons = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
        if (!navButtons) return;
        
        const charHeight = 16; // Fixed font size like dialogue
        const charWidth = 16 * 0.6; // Fixed character width ratio
        const verticalTextOffset = (charHeight - 16) / 2 + (16 * 0.1);
        const rightMargin = 40; // Right margin in pixels
        const buttonSpacing = 1; // Single character row spacing between buttons
        
        // Center vertically, right-aligned with margin - use character grid
        const centerY = Math.floor(canvasHeight / 2);
        
        ctx.save();
        ctx.font = `16px "${fontFamily}"`;
        ctx.textBaseline = 'top';
        
        // Track clickable regions
        const clickableRegions: Array<{type: 'login' | 'signup' | 'visit', rect: {x: number, y: number, width: number, height: number}}> = [];
        
        if (navButtons.isAuthenticated && navButtons.onVisitClick) {
            // === Render single Visit Button for authenticated users ===
            const visitText = 'visit';
            const buttonWidth = visitText.length * charWidth + 16; // Add padding
            
            const visitButtonX = canvasWidth - rightMargin - buttonWidth;
            const visitButtonY = centerY - charHeight / 2; // Centered vertically
            
            ctx.fillStyle = pressedNavButton === 'visit' ? '#333333' : '#000000';
            ctx.fillRect(visitButtonX, visitButtonY, buttonWidth, charHeight);
            
            ctx.fillStyle = '#FFFFFF';
            const visitTextX = visitButtonX + (buttonWidth - (visitText.length * charWidth)) / 2;
            ctx.fillText(visitText, visitTextX, visitButtonY + verticalTextOffset);
            
            clickableRegions.push({
                type: 'visit',
                rect: { x: visitButtonX, y: visitButtonY, width: buttonWidth, height: charHeight }
            });
        } else {
            // === Render Login and Signup Buttons for non-authenticated users ===
            const loginText = 'login';
            const signupText = 'signup';
            const buttonWidth = Math.max(loginText.length, signupText.length) * charWidth + 16; // Add padding
            
            // Position buttons on character grid - tight spacing like tagline
            const loginButtonX = canvasWidth - rightMargin - buttonWidth;
            const loginButtonY = centerY - charHeight - (buttonSpacing * charHeight / 2);
            
            const signupButtonX = canvasWidth - rightMargin - buttonWidth;
            const signupButtonY = centerY + (buttonSpacing * charHeight / 2);
            
            // === Render Login Button ===
            ctx.fillStyle = pressedNavButton === 'login' ? '#333333' : '#000000';
            ctx.fillRect(loginButtonX, loginButtonY, buttonWidth, charHeight);
            
            ctx.fillStyle = '#FFFFFF';
            const loginTextX = loginButtonX + (buttonWidth - (loginText.length * charWidth)) / 2;
            ctx.fillText(loginText, loginTextX, loginButtonY + verticalTextOffset);
            
            clickableRegions.push({
                type: 'login',
                rect: { x: loginButtonX, y: loginButtonY, width: buttonWidth, height: charHeight }
            });
            
            // === Render Signup Button ===
            ctx.fillStyle = pressedNavButton === 'signup' ? '#333333' : '#000000';
            ctx.fillRect(signupButtonX, signupButtonY, buttonWidth, charHeight);
            
            ctx.fillStyle = '#FFFFFF';
            const signupTextX = signupButtonX + (buttonWidth - (signupText.length * charWidth)) / 2;
            ctx.fillText(signupText, signupTextX, signupButtonY + verticalTextOffset);
            
            clickableRegions.push({
                type: 'signup',
                rect: { x: signupButtonX, y: signupButtonY, width: buttonWidth, height: charHeight }
            });
        }
        
        // Store regions for click handling
        (ctx.canvas as any).navClickableRegions = clickableRegions;
        
        ctx.restore();
    }, [navButtons, pressedNavButton]);

    // === Form Event Handlers (Dialogue-style) ===
    const handleFormClick = useCallback((clickX: number, clickY: number): boolean => {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        
        const regions = (canvas as any).formClickableRegions;
        if (!regions) return false;
        
        for (const region of regions) {
            if (clickX >= region.rect.x && clickX <= region.rect.x + region.rect.width &&
                clickY >= region.rect.y && clickY <= region.rect.y + region.rect.height) {
                
                if (region.type === 'back') {
                    setPressedButton('back');
                    setTimeout(() => setPressedButton(null), 150);
                    // Navigate back to home
                    if (typeof window !== 'undefined') {
                        window.history.pushState(null, '', '/');
                        // Trigger a popstate event to update the route
                        window.dispatchEvent(new PopStateEvent('popstate'));
                    }
                    return true;
                } else if (region.type === 'firstName') {
                    const layout = calculateFormLayout(canvasSize.width, canvasSize.height);
                    const relativeX = clickX - region.rect.x - 4;
                    const charIndex = Math.max(0, Math.min(
                        formState.firstName.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    setFocusedInput('firstName');
                    setFormState(prev => ({
                        ...prev,
                        firstName: { ...prev.firstName, cursorPos: charIndex }
                    }));
                    return true;
                } else if (region.type === 'lastName') {
                    const layout = calculateFormLayout(canvasSize.width, canvasSize.height);
                    const relativeX = clickX - region.rect.x - 4;
                    const charIndex = Math.max(0, Math.min(
                        formState.lastName.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    setFocusedInput('lastName');
                    setFormState(prev => ({
                        ...prev,
                        lastName: { ...prev.lastName, cursorPos: charIndex }
                    }));
                    return true;
                } else if (region.type === 'email') {
                    const layout = calculateFormLayout(canvasSize.width, canvasSize.height);
                    const relativeX = clickX - region.rect.x - 4;
                    const charIndex = Math.max(0, Math.min(
                        formState.email.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    setFocusedInput('email');
                    setFormState(prev => ({
                        ...prev,
                        email: { ...prev.email, cursorPos: charIndex }
                    }));
                    return true;
                } else if (region.type === 'password') {
                    const layout = calculateFormLayout(canvasSize.width, canvasSize.height);
                    const relativeX = clickX - region.rect.x - 4;
                    const charIndex = Math.max(0, Math.min(
                        formState.password.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    setFocusedInput('password');
                    setFormState(prev => ({
                        ...prev,
                        password: { ...prev.password, cursorPos: charIndex }
                    }));
                    return true;
                } else if (region.type === 'username') {
                    const layout = calculateFormLayout(canvasSize.width, canvasSize.height);
                    const relativeX = clickX - region.rect.x - 4 - layout.charWidth; // Account for @ symbol
                    const charIndex = Math.max(0, Math.min(
                        formState.username.value.length,
                        Math.floor(relativeX / layout.charWidth)
                    ));
                    setFocusedInput('username');
                    setFormState(prev => ({
                        ...prev,
                        username: { ...prev.username, cursorPos: charIndex }
                    }));
                    return true;
                } else if (region.type === 'toggle') {
                    setPressedButton('toggle');
                    setTimeout(() => setPressedButton(null), 150);
                    setPasswordVisible(prev => !prev);
                    return true;
                } else if (region.type === 'button') {
                    if (isSubmitting) return true; // Prevent multiple submissions
                    
                    setPressedButton('signup');
                    setTimeout(() => setPressedButton(null), 150);
                    
                    if (isSignup && signupStep === 1) {
                        // Transition to step 2
                        setSignupStep(2);
                        setFocusedInput('username');
                        // Clear any existing errors when moving to next step
                        if (submitError) setSubmitError(null);
                    } else if (isSignup && signupStep === 2) {
                        // Submit signup form
                        handleSignupSubmit();
                    } else {
                        // Submit login form
                        handleLoginSubmit();
                    }
                    return true;
                }
            }
        }
        return false;
    }, [formState, canvasSize, calculateFormLayout, isSubmitting, handleSignupSubmit, handleLoginSubmit, signupStep, isSignup]);
    
    const handleFormKeyDown = useCallback((key: string): boolean => {
        if (!focusedInput) return false;
        
        const field = focusedInput;
        const currentValue = formState[field].value;
        const currentCursorPos = formState[field].cursorPos;
        
        if (key === 'Backspace') {
            // Special handling for username field - don't allow deleting past @ symbol
            if (field === 'username' && currentCursorPos === 0) {
                return true; // Block backspace at beginning of username
            }
            if (currentCursorPos > 0) {
                const newValue = currentValue.slice(0, currentCursorPos - 1) + currentValue.slice(currentCursorPos);
                setFormState(prev => ({
                    ...prev,
                    [field]: { ...prev[field], value: newValue, cursorPos: currentCursorPos - 1 }
                }));
            }
            return true;
        } else if (key === 'Delete') {
            if (currentCursorPos < currentValue.length) {
                const newValue = currentValue.slice(0, currentCursorPos) + currentValue.slice(currentCursorPos + 1);
                setFormState(prev => ({
                    ...prev,
                    [field]: { ...prev[field], value: newValue }
                }));
            }
            return true;
        } else if (key === 'ArrowLeft') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: Math.max(0, currentCursorPos - 1) }
            }));
            return true;
        } else if (key === 'ArrowRight') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: Math.min(currentValue.length, currentCursorPos + 1) }
            }));
            return true;
        } else if (key === 'Home') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: 0 }
            }));
            return true;
        } else if (key === 'End') {
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], cursorPos: currentValue.length }
            }));
            return true;
        } else if (key === 'Tab') {
            // Tab navigation through fields based on current step
            if (isSignup && signupStep === 1) {
                const step1Order: typeof focusedInput[] = ['firstName', 'lastName', 'email', 'password'];
                const currentIndex = step1Order.indexOf(focusedInput);
                const nextIndex = (currentIndex + 1) % step1Order.length;
                setFocusedInput(step1Order[nextIndex]);
            } else if (isSignup && signupStep === 2) {
                // Only username field in step 2, keep focus on it
                setFocusedInput('username');
            } else {
                // Login: toggle between email and password
                setFocusedInput(focusedInput === 'email' ? 'password' : 'email');
            }
            return true;
        } else if (key === 'Enter') {
            if (isSubmitting) return true; // Prevent submission during loading
            
            if (isSignup && signupStep === 1) {
                const step1Order: typeof focusedInput[] = ['firstName', 'lastName', 'email', 'password'];
                const currentIndex = step1Order.indexOf(focusedInput);
                if (currentIndex < step1Order.length - 1) {
                    setFocusedInput(step1Order[currentIndex + 1]);
                } else {
                    // Move to step 2
                    setSignupStep(2);
                    setFocusedInput('username');
                    // Clear any existing errors when moving to next step
                    if (submitError) setSubmitError(null);
                }
            } else if (isSignup && signupStep === 2) {
                // Submit signup form
                handleSignupSubmit();
            } else {
                // Login form
                if (focusedInput === 'email') {
                    setFocusedInput('password');
                } else {
                    handleLoginSubmit();
                }
            }
            return true;
        } else if (key.length === 1 && !key.match(/[\x00-\x1F\x7F]/)) {
            // Clear error when user starts typing
            if (submitError) setSubmitError(null);
            
            const newValue = currentValue.slice(0, currentCursorPos) + key + currentValue.slice(currentCursorPos);
            setFormState(prev => ({
                ...prev,
                [field]: { ...prev[field], value: newValue, cursorPos: currentCursorPos + 1 }
            }));
            return true;
        }
        
        return false;
    }, [focusedInput, formState, isSignup, isSubmitting, handleSignupSubmit, handleLoginSubmit, signupStep, submitError]);

    // === Navigation Button Event Handler ===
    const handleNavButtonClick = useCallback((clickX: number, clickY: number): boolean => {
        if (!navButtons) return false;
        
        const canvas = canvasRef.current;
        if (!canvas) return false;
        
        const regions = (canvas as any).navClickableRegions;
        if (!regions) return false;
        
        for (const region of regions) {
            if (clickX >= region.rect.x && clickX <= region.rect.x + region.rect.width &&
                clickY >= region.rect.y && clickY <= region.rect.y + region.rect.height) {
                
                if (region.type === 'login' && navButtons.onLoginClick) {
                    setPressedNavButton('login');
                    setTimeout(() => setPressedNavButton(null), 150);
                    navButtons.onLoginClick();
                    return true;
                } else if (region.type === 'signup' && navButtons.onSignupClick) {
                    setPressedNavButton('signup');
                    setTimeout(() => setPressedNavButton(null), 150);
                    navButtons.onSignupClick();
                    return true;
                } else if (region.type === 'visit' && navButtons.onVisitClick) {
                    setPressedNavButton('visit');
                    setTimeout(() => setPressedNavButton(null), 150);
                    navButtons.onVisitClick();
                    return true;
                }
            }
        }
        return false;
    }, [navButtons]);

    // === Canvas Setup (BitCanvas pattern) ===
    const handleResize = useCallback(() => {
        const dpr = window.devicePixelRatio || 1;
        devicePixelRatioRef.current = dpr;
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;
        setCanvasSize({ width: cssWidth, height: cssHeight });

        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = Math.floor(cssWidth * dpr);
            canvas.height = Math.floor(cssHeight * dpr);
            canvas.style.width = `${cssWidth}px`;
            canvas.style.height = `${cssHeight}px`;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.imageSmoothingEnabled = false;
        }
    }, []);

    useEffect(() => {
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [handleResize]);

    // === Drawing Logic (Dialogue style with form overlay) ===
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const dpr = devicePixelRatioRef.current;
        const { width: cssWidth, height: cssHeight } = canvasSize;
        if (cssWidth === 0 || cssHeight === 0) return;

        const currentZoom = engine.zoomLevel;
        const { width: effectiveCharWidth, height: effectiveCharHeight, fontSize: effectiveFontSize } = engine.getEffectiveCharDims(currentZoom);
        const currentOffset = engine.viewOffset;
        const verticalTextOffset = 0;

        ctx.save();
        ctx.scale(dpr, dpr);
        
        // Clear canvas
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        
        ctx.imageSmoothingEnabled = false;
        ctx.font = `${effectiveFontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top';

        const startWorldX = currentOffset.x;
        const startWorldY = currentOffset.y;
        const endWorldX = startWorldX + (cssWidth / effectiveCharWidth);
        const endWorldY = startWorldY + (cssHeight / effectiveCharHeight);

        // === Render Monogram Patterns ===
        if (monogramEnabled) {
            const monogramPattern = monogramSystem.generateMonogramPattern(
                startWorldX, startWorldY, endWorldX, endWorldY
            );
            
            for (const key in monogramPattern) {
                const [xStr, yStr] = key.split(',');
                const worldX = parseInt(xStr, 10);
                const worldY = parseInt(yStr, 10);
                
                if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                    const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                    if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                        screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                        
                        const cell = monogramPattern[key];
                        
                        // Only render if there's no regular text at this position
                        const textKey = `${worldX},${worldY}`;
                        const charData = engine.worldData[textKey];
                        const char = charData && !engine.isImageData(charData) ? engine.getCharacter(charData) : '';
                        if (!char || char.trim() === '') {
                            ctx.fillStyle = cell.color;
                            ctx.fillText(cell.char, screenPos.x, screenPos.y + verticalTextOffset);
                        }
                    }
                }
            }
        }

        // === Render Basic Text ===
        ctx.fillStyle = engine.textColor;
        for (const key in engine.worldData) {
            const [xStr, yStr] = key.split(',');
            if (isNaN(parseInt(xStr)) || isNaN(parseInt(yStr))) continue;
            
            const worldX = parseInt(xStr, 10);
            const worldY = parseInt(yStr, 10);
            
            if (worldX >= startWorldX - 5 && worldX <= endWorldX + 5 && worldY >= startWorldY - 5 && worldY <= endWorldY + 5) {
                const charData = engine.worldData[key];
                const char = charData && !engine.isImageData(charData) ? engine.getCharacter(charData) : '';
                const screenPos = engine.worldToScreen(worldX, worldY, currentZoom, currentOffset);
                
                if (screenPos.x > -effectiveCharWidth * 2 && screenPos.x < cssWidth + effectiveCharWidth && 
                    screenPos.y > -effectiveCharHeight * 2 && screenPos.y < cssHeight + effectiveCharHeight) {
                    if (char && char.trim() !== '') {
                        ctx.fillStyle = engine.textColor;
                        ctx.fillText(char, screenPos.x, screenPos.y + verticalTextOffset);
                    }
                }
            }
        }

        // === Render Form (Dialogue-style overlay) ===
        if (showForm) {
            renderForm(ctx, cssWidth, cssHeight);
        }

        // === Render Tagline (Dialogue-style overlay) ===
        if (taglineText) {
            renderTagline(ctx, cssWidth, cssHeight);
        }

        // === Render Navigation Buttons (Dialogue-style overlay) ===
        if (navButtons) {
            renderNavButtons(ctx, cssWidth, cssHeight);
        }

        ctx.restore();
    }, [engine, canvasSize, monogramSystem, monogramEnabled, showForm, renderForm, taglineText, renderTagline, navButtons, renderNavButtons]);

    // === Drawing Loop ===
    useEffect(() => {
        let animationFrameId: number;
        const renderLoop = () => {
            draw();
            animationFrameId = requestAnimationFrame(renderLoop);
        };
        renderLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [draw]);

    // === Event Handlers ===
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Try form click first (dialogue pattern)
        if (showForm && handleFormClick(clickX, clickY)) {
            canvasRef.current?.focus();
            return;
        }
        
        // Try navigation button click (dialogue pattern)
        if (navButtons && handleNavButtonClick(clickX, clickY)) {
            canvasRef.current?.focus();
            return;
        }
        
        // Clear focus if clicking elsewhere
        if (showForm) {
            setFocusedInput(null);
        }
        canvasRef.current?.focus();
    }, [showForm, handleFormClick, navButtons, handleNavButtonClick]);
    
    const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
        // Try form key handling first
        if (showForm && handleFormKeyDown(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }, [showForm, handleFormKeyDown]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            onClick={handleCanvasClick}
            onKeyDown={handleCanvasKeyDown}
            tabIndex={0}
            style={{ display: 'block', outline: 'none', width: '100%', height: '100%', cursor: 'text' }}
        />
    );
}