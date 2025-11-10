import React, { useEffect, useRef } from 'react';

interface DebugLog {
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
}

interface FaceDebugOverlayProps {
    enabled: boolean;
}

// Global log storage
const debugLogs: DebugLog[] = [];
const maxLogs = 20;

// Global function to add logs
export const addFaceDebugLog = (level: DebugLog['level'], message: string) => {
    debugLogs.push({
        timestamp: Date.now(),
        level,
        message
    });

    // Keep only last N logs
    if (debugLogs.length > maxLogs) {
        debugLogs.shift();
    }

    // Also log to console
    const prefix = `[Face Debug]`;
    switch (level) {
        case 'error':
            console.error(prefix, message);
            break;
        case 'warn':
            console.warn(prefix, message);
            break;
        case 'success':
            console.log(prefix, '✓', message);
            break;
        default:
            console.log(prefix, message);
    }
};

export const FaceDebugOverlay: React.FC<FaceDebugOverlayProps> = ({ enabled }) => {
    const [logs, setLogs] = React.useState<DebugLog[]>([]);
    const [copySuccess, setCopySuccess] = React.useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!enabled) {
            setLogs([]);
            return;
        }

        // Poll for new logs
        const interval = setInterval(() => {
            setLogs([...debugLogs]);

            // Auto-scroll to bottom
            if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
        }, 100);

        return () => clearInterval(interval);
    }, [enabled]);

    const handleCopyLogs = async () => {
        const logsText = logs.map(log => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 1
            });
            return `${timeStr} [${log.level.toUpperCase()}] ${log.message}`;
        }).join('\n');

        try {
            await navigator.clipboard.writeText(logsText);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
            console.error('Failed to copy logs:', err);
        }
    };

    if (!enabled) return null;

    const getLevelColor = (level: DebugLog['level']) => {
        switch (level) {
            case 'error':
                return '#FF5252';
            case 'warn':
                return '#FFA726';
            case 'success':
                return '#66BB6A';
            default:
                return '#42A5F5';
        }
    };

    const getLevelIcon = (level: DebugLog['level']) => {
        switch (level) {
            case 'error':
                return '✗';
            case 'warn':
                return '⚠';
            case 'success':
                return '✓';
            default:
                return '•';
        }
    };

    return (
        <>
            {/* Copy Button - Bottom Left */}
            <button
                onClick={handleCopyLogs}
                style={{
                    position: 'fixed',
                    bottom: '20px',
                    left: '20px',
                    backgroundColor: copySuccess ? '#66BB6A' : 'rgba(0, 0, 0, 0.9)',
                    color: '#FFFFFF',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '11px',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    cursor: 'pointer',
                    zIndex: 10001,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                    backdropFilter: 'blur(10px)',
                    transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                    if (!copySuccess) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    }
                }}
                onMouseLeave={(e) => {
                    if (!copySuccess) {
                        e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
                    }
                }}
            >
                {copySuccess ? '✓ Copied!' : '📋 Copy Logs'}
            </button>

            {/* Debug Overlay - Bottom Right */}
            <div
                ref={containerRef}
                style={{
                    position: 'fixed',
                    bottom: '20px',
                    right: '20px',
                    width: '400px',
                    maxHeight: '300px',
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    color: '#FFFFFF',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '11px',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    overflowY: 'auto',
                    zIndex: 10000,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                    backdropFilter: 'blur(10px)',
                }}
            >
                <div style={{
                    marginBottom: '8px',
                    paddingBottom: '8px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                    fontWeight: 'bold',
                    color: '#FFA500'
                }}>
                    🎯 Face Detection Debug
                </div>

            {logs.length === 0 ? (
                <div style={{ color: '#888', fontStyle: 'italic' }}>
                    Waiting for logs...
                </div>
            ) : (
                logs.map((log, index) => {
                    const timeStr = new Date(log.timestamp).toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        fractionalSecondDigits: 1
                    });

                    return (
                        <div
                            key={index}
                            style={{
                                marginBottom: '4px',
                                paddingLeft: '8px',
                                borderLeft: `2px solid ${getLevelColor(log.level)}`,
                                lineHeight: '1.4'
                            }}
                        >
                            <span style={{ color: '#888', marginRight: '8px' }}>
                                {timeStr}
                            </span>
                            <span style={{ color: getLevelColor(log.level), marginRight: '4px' }}>
                                {getLevelIcon(log.level)}
                            </span>
                            <span style={{ color: '#FFF' }}>
                                {log.message}
                            </span>
                        </div>
                    );
                })
            )}
            </div>
        </>
    );
};
