/**
 * Client-Side PDF Builder using jsPDF
 * Faithfully reproduces the ReportLab dark A4 canvas layout.
 */

import { blobToDataUrl, getImageDimensions } from './extractor.js';

export async function createInstagramPdf(imageBlobs, shortcode, onProgress) {
  // Access jsPDF from UMD bundle
  const jsPDF = window.jspdf?.jsPDF || globalThis.jspdf?.jsPDF;
  if (!jsPDF) {
    throw new Error('jsPDF library failed to load.');
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15; // 1.5 cm
  const usableWidth = pageWidth - 2 * margin;
  const usableHeight = pageHeight - 2 * margin;

  const total = imageBlobs.length;

  for (let i = 0; i < total; i++) {
    if (i > 0) {
      doc.addPage('a4', 'portrait');
    }

    if (onProgress) {
      onProgress(i + 1, total, `Processing page ${i + 1} of ${total}…`);
    }

    // 1. Dark background (#0f0f0f)
    doc.setFillColor(15, 15, 15);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // 2. Decode image and calculate centered aspect ratio
    const dataUrl = await blobToDataUrl(imageBlobs[i]);
    const { width: imgW, height: imgH } = await getImageDimensions(dataUrl);

    const scale = Math.min(usableWidth / imgW, usableHeight / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;

    const x = margin + (usableWidth - drawW) / 2;
    const y = margin + (usableHeight - drawH) / 2;

    // Determine format
    const format = imageBlobs[i].type.includes('png') ? 'PNG' : 'JPEG';
    doc.addImage(dataUrl, format, x, y, drawW, drawH, undefined, 'FAST');

    // 3. Page numbering (subtle Helvetica 8pt #555555)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    doc.text(`${i + 1} / ${total}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

  // Set document metadata
  doc.setProperties({
    title: `Instagram Post - ${shortcode}`,
    subject: `https://www.instagram.com/p/${shortcode}/`,
    author: 'InstaConvert Chrome Extension',
    creator: 'InstaConvert',
  });

  return doc.output('blob');
}
