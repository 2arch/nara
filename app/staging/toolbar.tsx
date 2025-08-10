"use client";
import React, { useRef } from 'react';

interface ToolbarProps {
    onUpload: (file: File) => void;
}

const Toolbar: React.FC<ToolbarProps> = ({ onUpload }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            onUpload(file);
        }
    };

    return (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-4">
                <button
                    onClick={handleUploadClick}
                    className="text-white bg-black line-height-1"
                >
                    Upload
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/gif"
                />
            </div>
        </div>
    );
};

export default Toolbar;
