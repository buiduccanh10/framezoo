import { useEffect, useState } from "react";
import type { DragEvent, ReactNode } from "react";

interface FileDropHandlerProps {
  children: ReactNode;
  className: string;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDraggingChange: (isDragging: boolean) => void;
}

interface FileDropBindingProps {
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

export function useFileDrop(props: {
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDraggingChange?: (isDragging: boolean) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragging(false);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);

    props.onDrop(event);
  };

  useEffect(() => {
    props.onDraggingChange?.(dragging);
  }, [dragging, props]);

  const fileDropProps: FileDropBindingProps = {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  };

  return {
    dragging,
    fileDropProps,
  };
}

export function FileDropHandler(props: FileDropHandlerProps) {
  const { fileDropProps } = useFileDrop(props);

  return (
    <div {...fileDropProps} className={props.className}>
      {props.children}
    </div>
  );
}
