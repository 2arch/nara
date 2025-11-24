import { Point } from './world.engine';
import { storage } from '@/app/firebase';
import { ref as storageRef, uploadString, getDownloadURL, listAll, getMetadata } from 'firebase/storage';

export interface FrameData {
    timestamp: number;
    face: {
        rotX: number;
        rotY: number;
        rotZ: number;
        mouthOpen?: number;
        leftEyeBlink?: number;
        rightEyeBlink?: number;
        isTracked?: boolean;
    } | undefined;
    cursor: Point;
    viewOffset: Point;
    zoomLevel: number;
}

export interface ContentChange {
    timestamp: number;
    key: string;
    value: any;
}

export interface RecordingSession {
    name: string;
    startTime: number;
    duration: number;
    frames: FrameData[];
    contentChanges: ContentChange[];
}

export class DataRecorder {
    isRecording: boolean = false;
    isPlaying: boolean = false;
    currentRecording: RecordingSession | null = null;
    private frames: FrameData[] = [];
    private contentChanges: ContentChange[] = [];
    private startTime: number = 0;
    private playbackStart: number = 0;
    private playbackIndex: number = 0;
    private contentChangeIndex: number = 0;
    public userOverrodeViewport: boolean = false; // Track if user manually panned/zoomed during playback

    start() {
        this.isRecording = true;
        this.frames = [];
        this.contentChanges = [];
        this.startTime = Date.now();
        console.log('Recording started');
    }

    stop(): RecordingSession | null {
        if (!this.isRecording) return null;
        this.isRecording = false;
        const duration = Date.now() - this.startTime;

        this.currentRecording = {
            name: `recording_${this.startTime}`,
            startTime: this.startTime,
            duration,
            frames: this.frames,
            contentChanges: this.contentChanges
        };

        console.log(`Recording stopped. Captured ${this.frames.length} frames and ${this.contentChanges.length} content changes.`);
        console.log('Content changes:', this.contentChanges);
        return this.currentRecording;
    }

    capture(engine: any) {
        if (!this.isRecording) return;

        const frame: FrameData = {
            timestamp: Date.now() - this.startTime,
            face: engine.faceOrientation ? { ...engine.faceOrientation } : undefined,
            cursor: { ...engine.cursorPos },
            viewOffset: { ...engine.viewOffset },
            zoomLevel: engine.zoomLevel
        };

        this.frames.push(frame);
    }

    recordContentChange(key: string, value: any) {
        if (!this.isRecording) return;

        const change: ContentChange = {
            timestamp: Date.now() - this.startTime,
            key,
            value
        };

        this.contentChanges.push(change);
    }

    loadRecording(session: RecordingSession) {
        this.currentRecording = session;
        this.playbackIndex = 0;
        this.contentChangeIndex = 0;
    }

    startPlayback() {
        if (!this.currentRecording) {
            console.log('Cannot start playback: no currentRecording');
            return;
        }
        this.isPlaying = true;
        this.playbackStart = Date.now();
        this.playbackIndex = 0;
        this.contentChangeIndex = 0;
        this.userOverrodeViewport = false; // Reset viewport override flag
        console.log('Playback started');
        console.log(`Recording has ${this.currentRecording.frames.length} frames and ${this.currentRecording.contentChanges.length} content changes`);
        console.log('Content changes to play:', this.currentRecording.contentChanges);
    }

    stopPlayback() {
        this.isPlaying = false;
        console.log('Playback stopped');
    }

    getPlaybackFrame(): FrameData | null {
        if (!this.isPlaying || !this.currentRecording) return null;

        const elapsed = Date.now() - this.playbackStart;

        if (elapsed > this.currentRecording.duration) {
            this.stopPlayback();
            return null;
        }

        // Advance index to find the latest frame that matches current time
        while(this.playbackIndex < this.currentRecording.frames.length - 1 &&
              this.currentRecording.frames[this.playbackIndex + 1].timestamp <= elapsed) {
            this.playbackIndex++;
        }

        return this.currentRecording.frames[this.playbackIndex];
    }

    getPlaybackContentChanges(): ContentChange[] {
        if (!this.isPlaying || !this.currentRecording) return [];

        const elapsed = Date.now() - this.playbackStart;
        const changes: ContentChange[] = [];

        // Apply all content changes that are due up to current time (in order)
        // This ensures playback stays synchronized and doesn't lag behind
        while (this.contentChangeIndex < this.currentRecording.contentChanges.length &&
               this.currentRecording.contentChanges[this.contentChangeIndex].timestamp <= elapsed) {
            changes.push(this.currentRecording.contentChanges[this.contentChangeIndex]);
            this.contentChangeIndex++;
        }

        return changes;
    }
    
    // Export recording as JSON string
    exportRecording(): string {
        return JSON.stringify(this.currentRecording);
    }
    
    // Import recording from JSON string
    importRecording(json: string): boolean {
        try {
            const session = JSON.parse(json) as RecordingSession;
            if (session.frames && Array.isArray(session.frames)) {
                // Ensure backward compatibility with old recordings without contentChanges
                if (!session.contentChanges) {
                    session.contentChanges = [];
                }
                this.loadRecording(session);
                return true;
            }
            return false;
        } catch (e) {
            console.error('Failed to import recording', e);
            return false;
        }
    }

    // Save recording to Firebase Storage (global recordings location)
    async saveToFirebase(name: string): Promise<{ success: boolean; error?: string }> {
        if (!this.currentRecording) {
            return { success: false, error: 'No recording to save' };
        }

        try {
            const json = this.exportRecording();
            if (!json || json === 'null') {
                return { success: false, error: 'No recording data' };
            }

            // Save to global recordings location
            const basePath = `recordings/${name}.json`;

            const recordingRef = storageRef(storage, basePath);
            await uploadString(recordingRef, json, 'raw', {
                contentType: 'application/json',
                customMetadata: {
                    duration: this.currentRecording.duration.toString(),
                    frames: this.currentRecording.frames.length.toString(),
                    contentChanges: this.currentRecording.contentChanges.length.toString(),
                    createdAt: new Date().toISOString()
                }
            });

            const url = await getDownloadURL(recordingRef);
            console.log(`Recording saved to Firebase: ${url}`);
            return { success: true };
        } catch (error) {
            console.error('Error saving recording to Firebase:', error);
            return { success: false, error: (error as Error).message };
        }
    }

    // Load recording from Firebase Storage
    async loadFromFirebase(name: string): Promise<{ success: boolean; error?: string }> {
        try {
            const path = `recordings/${name}.json`;
            const recordingRef = storageRef(storage, path);
            const url = await getDownloadURL(recordingRef);
            const response = await fetch(url);
            const json = await response.text();

            if (this.importRecording(json)) {
                console.log(`Recording loaded from Firebase: ${path}`);
                return { success: true };
            }

            return { success: false, error: 'Failed to parse recording' };
        } catch (error) {
            console.error('Error loading recording from Firebase:', error);
            return { success: false, error: (error as Error).message };
        }
    }

    // List available recordings
    async listRecordings(): Promise<{ name: string; metadata?: any }[]> {
        try {
            const recordings: { name: string; metadata?: any }[] = [];

            // List all global recordings
            const recordingsRef = storageRef(storage, 'recordings/');
            const recordingsList = await listAll(recordingsRef);
            for (const item of recordingsList.items) {
                const name = item.name.replace('.json', '');
                try {
                    const metadata = await getMetadata(item);
                    recordings.push({ name, metadata: metadata.customMetadata });
                } catch {
                    recordings.push({ name });
                }
            }

            return recordings;
        } catch (error) {
            console.error('Error listing recordings:', error);
            return [];
        }
    }
}
