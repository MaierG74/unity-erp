'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/lib/supabase';
import { generateUniqueImageName, getProductImagePath } from '@/lib/utils/image';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from "@/components/ui/use-toast";
import { Upload, X } from 'lucide-react';
import Image from 'next/image';

interface ImageUploadProps {
  productCode: string;
  productId: string;
  onUploadComplete?: (url: string) => void;
  className?: string;
}

interface UploadingFile {
  file: File;
  progress: number;
}

export function ImageUpload({ productCode, productId, onUploadComplete, className }: ImageUploadProps) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const { toast } = useToast();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      progress: 0,
    }));
    setUploadingFiles((prev) => [...prev, ...newFiles]);

    for (const fileData of newFiles) {
      const { file } = fileData;
      const uniqueName = generateUniqueImageName(productCode, file.name);
      const filePath = getProductImagePath(productCode, uniqueName);

      try {
        const { error: uploadError, data } = await supabase.storage
          .from("QButton")
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadError) {
          throw uploadError;
        }

        // Update progress after successful upload
        setUploadingFiles((files) =>
          files.map((f) =>
            f.file === file ? { ...f, progress: 100 } : f
          )
        );

        const {
          data: { publicUrl },
        } = supabase.storage.from("QButton").getPublicUrl(filePath);

        // Save to product_images table
        const { error: dbError } = await supabase
          .from("product_images")
          .insert({
            product_id: productId,
            image_url: publicUrl,
            is_primary: false,
          });

        if (dbError) throw dbError;

        toast({
          title: "Success",
          description: `File ${file.name} uploaded successfully`,
        });

        if (onUploadComplete) {
          onUploadComplete(publicUrl);
        }
      } catch (error) {
        console.error("Upload error:", error);
        toast({
          title: "Error",
          description: `Failed to upload ${file.name}`,
          variant: "destructive",
        });
      } finally {
        setUploadingFiles((files) =>
          files.filter((f) => f.file !== file)
        );
      }
    }
  }, [productCode, productId, onUploadComplete, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    multiple: true,
    noClick: false
  });

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive ? 'border-primary bg-primary/10' : 'border-border'}
        `}
      >
        <input {...getInputProps()} className="hidden" />
        <Upload className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
        {isDragActive ? (
          <p>Drop the files here...</p>
        ) : (
          <div className="space-y-2">
            <p>Drag and drop images here, or click to select files</p>
            <p className="text-sm text-muted-foreground">
              Supports: PNG, JPG, GIF, WEBP
            </p>
          </div>
        )}
      </div>

      {/* Upload Progress */}
      {uploadingFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploadingFiles.map((file) => (
            <div key={file.file.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>{file.file.name}</span>
                <span>{Math.round(file.progress)}%</span>
              </div>
              <Progress value={file.progress} className="h-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 