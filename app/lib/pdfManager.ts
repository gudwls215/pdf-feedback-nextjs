import * as pdfjsLib from 'pdfjs-dist';

// PDF.js worker 설정
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
}

export class PDFManager {
  private pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;

  constructor(canvas?: HTMLCanvasElement) {
    if (canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d');
    }
  }

  async loadPDF(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument(arrayBuffer);
    this.pdfDocument = await loadingTask.promise;
    return this.pdfDocument;
  }

  async renderPage(pageNumber: number, scale: number = 1.5): Promise<void> {
    if (!this.pdfDocument || !this.canvas || !this.context) {
      throw new Error('PDF document or canvas not initialized');
    }

    const page = await this.pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    this.canvas.height = viewport.height;
    this.canvas.width = viewport.width;

    const renderContext = {
      canvasContext: this.context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;
  }

  getTotalPages(): number {
    return this.pdfDocument?.numPages || 0;
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }
}

export const createPDFFromCanvas = async (canvas: HTMLCanvasElement): Promise<Blob> => {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob!);
    }, 'image/png');
  });
};
