import React, { useMemo } from "react";

type ImageViewerProps = {
  /** base64 string coming from rosbridge */
  data: string | null | undefined;

  /** mime type of image (jpeg is common for CompressedImage) */
  mimeType?: "image/jpeg" | "image/png" | "image/webp";

  /** optional styling */
  className?: string;
  alt?: string;
};

const ImageViewer: React.FC<ImageViewerProps> = ({
  data,
  mimeType = "image/jpeg",
  className,
  alt = "camera stream",
}) => {
  // convert base64 → data url only when data changes
  const src = useMemo(() => {
    if (!data) return "";
    return `data:${mimeType};base64,${data}`;
  }, [data, mimeType]);

  if (!data) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground">
        No Image
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className ?? "w-full h-full object-contain"}
    />
  );
};

export default ImageViewer;
