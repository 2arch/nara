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

// Action types for high-level user actions (selections, commands, etc.)
export type ActionType =
    | 'selection_start'
    | 'selection_update'
    | 'selection_end'
    | 'selection_clear'
    | 'command_start'
    | 'command_execute';

export interface Action {
    timestamp: number;
    type: ActionType;
    data: any; // Type-specific data (e.g., Point for selection, string for command)
}

export interface RecordingSession {
    name: string;
    startTime: number;
    duration: number;
    frames: FrameData[];
    contentChanges: ContentChange[];
    actions: Action[]; // High-level user actions
}

export class DataRecorder {
    isRecording: boolean = false;
    isPlaying: boolean = false;
    currentRecording: RecordingSession | null = null;
    private frames: FrameData[] = [];
    private contentChanges: ContentChange[] = [];
    private actions: Action[] = [];
    private startTime: number = 0;
    private playbackStart: number = 0;
    private playbackIndex: number = 0;
    private contentChangeIndex: number = 0;
    private actionIndex: number = 0; // Track action playback
    public userOverrodeViewport: boolean = false; // Track if user manually panned/zoomed during playback
    private recordingCounter: number = 0; // Auto-incrementing counter for recordings

    start() {
        this.isRecording = true;
        this.frames = [];
        this.contentChanges = [];
        this.actions = [];
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
            contentChanges: this.contentChanges,
            actions: this.actions
        };

        console.log(`Recording stopped. Captured ${this.frames.length} frames, ${this.contentChanges.length} content changes, and ${this.actions.length} actions.`);
        console.log('Actions:', this.actions);
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

    // Record high-level user actions (selections, commands)
    recordAction(type: ActionType, data: any) {
        if (!this.isRecording) return;

        const action: Action = {
            timestamp: Date.now() - this.startTime,
            type,
            data
        };

        this.actions.push(action);
        console.log(`[Recording] Action recorded: ${type}`, data);
    }

    loadRecording(session: RecordingSession) {
        this.currentRecording = session;
        this.playbackIndex = 0;
        this.contentChangeIndex = 0;
        this.actionIndex = 0;
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
        this.actionIndex = 0;
        this.userOverrodeViewport = false; // Reset viewport override flag
        console.log('Playback started');
        console.log(`Recording has ${this.currentRecording.frames.length} frames, ${this.currentRecording.contentChanges.length} content changes, and ${this.currentRecording.actions?.length || 0} actions`);
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

    // Get actions that should be played back at current time
    getPlaybackActions(): Action[] {
        if (!this.isPlaying || !this.currentRecording) return [];
        if (!this.currentRecording.actions) return []; // Backward compatibility

        const elapsed = Date.now() - this.playbackStart;
        const actions: Action[] = [];

        // Apply all actions that are due up to current time
        while (this.actionIndex < this.currentRecording.actions.length &&
               this.currentRecording.actions[this.actionIndex].timestamp <= elapsed) {
            actions.push(this.currentRecording.actions[this.actionIndex]);
            this.actionIndex++;
        }

        return actions;
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
                // Ensure backward compatibility with old recordings
                if (!session.contentChanges) {
                    session.contentChanges = [];
                }
                if (!session.actions) {
                    session.actions = [];
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
                    actions: this.currentRecording.actions.length.toString(),
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

            // Sort by name (recording_1, recording_2, etc. will sort naturally)
            recordings.sort((a, b) => a.name.localeCompare(b.name));

            return recordings;
        } catch (error) {
            console.error('Error listing recordings:', error);
            return [];
        }
    }

    // Get next auto-generated recording name
    async getNextRecordingName(): Promise<string> {
        const recordings = await this.listRecordings();

        // Find highest number from existing recordings (e.g., recording_5 -> 5)
        let maxNum = 0;
        for (const rec of recordings) {
            const match = rec.name.match(/^recording_(\d+)$/);
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxNum) maxNum = num;
            }
        }

        return `recording_${maxNum + 1}`;
    }
}
