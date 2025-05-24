'use client';

import { 
  File, 
  FileText, 
  FileImage, 
  FileSpreadsheet, 
  FilePlus, 
  FileArchive
} from 'lucide-react';

interface FileIconProps {
  fileName: string;
  size?: number;
  className?: string;
}

/**
 * A component to display different file type icons based on the file extension.
 */
export function FileIcon({ 
  fileName, 
  size = 48, 
  className = '' 
}: FileIconProps) {
  if (!fileName) return <File size={size} className={className} />;
  
  const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
  
  switch (fileExt) {
    case 'pdf':
      return <FileText size={size} className={className} />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
      return <FileImage size={size} className={className} />;
    case 'xls':
    case 'xlsx':
    case 'csv':
      return <FileSpreadsheet size={size} className={className} />;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return <FileArchive size={size} className={className} />;
    default:
      return <File size={size} className={className} />;
  }
}

export default FileIcon; 