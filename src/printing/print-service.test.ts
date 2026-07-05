import assert from 'node:assert/strict';
import test from 'node:test';

import { createPrintService } from './print-service.js';

test('print service inspects PDFs with pdfinfo', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const service = createPrintService({
    runner: async (command, args) => {
      calls.push({ command, args });
      return { stdout: 'Pages:           12\n', stderr: '', exitCode: 0 };
    },
  });

  assert.deepEqual(await service.inspectPdf('/tmp/personaje.pdf'), { pageCount: 12 });
  assert.deepEqual(calls, [{ command: 'pdfinfo', args: ['/tmp/personaje.pdf'] }]);
});

test('print service converts office files to PDF with LibreOffice headless', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const service = createPrintService({
    runner: async (command, args) => {
      calls.push({ command, args });
      return { stdout: 'convert /tmp/fichas.docx -> /tmp/out/fichas.pdf\n', stderr: '', exitCode: 0 };
    },
  });

  assert.equal(await service.convertOfficeToPdf('/tmp/fichas.docx', '/tmp/out'), '/tmp/out/fichas.pdf');
  assert.deepEqual(calls, [{
    command: 'soffice',
    args: ['--headless', '--convert-to', 'pdf', '--outdir', '/tmp/out', '/tmp/fichas.docx'],
  }]);
});

test('print service converts image files to a portrait one-page PDF with ImageMagick', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const service = createPrintService({
    runner: async (command, args) => {
      calls.push({ command, args });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });

  assert.equal(await service.convertImageToPdf('/tmp/foto.jpg', '/tmp/out', 'portrait'), '/tmp/out/foto.pdf');
  assert.deepEqual(calls, [{
    command: 'magick',
    args: [
      '/tmp/foto.jpg',
      '-auto-orient',
      '-resize',
      '595x842>',
      '-gravity',
      'center',
      '-background',
      'white',
      '-extent',
      '595x842',
      '/tmp/out/foto.pdf',
    ],
  }]);
});

test('print service converts landscape image files to a landscape one-page PDF with ImageMagick', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const service = createPrintService({
    runner: async (command, args) => {
      calls.push({ command, args });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });

  assert.equal(await service.convertImageToPdf('/tmp/mapa.png', '/tmp/out', 'landscape'), '/tmp/out/mapa.pdf');
  assert.deepEqual(calls, [{
    command: 'magick',
    args: [
      '/tmp/mapa.png',
      '-auto-orient',
      '-resize',
      '842x595>',
      '-gravity',
      'center',
      '-background',
      'white',
      '-extent',
      '842x595',
      '/tmp/out/mapa.pdf',
    ],
  }]);
});

test('print service detects duplex support from lpoptions', async () => {
  const service = createPrintService({
    runner: async () => ({
      stdout: 'Duplex/2-Sided Printing: *None DuplexNoTumble DuplexTumble\n',
      stderr: '',
      exitCode: 0,
    }),
  });

  assert.deepEqual(await service.getPrinterStatus('HP-LaserJet-P2015-Series'), {
    queue: 'HP-LaserJet-P2015-Series',
    duplexSupported: true,
  });
});

test('print service treats an uninstalled duplexer as no duplex support', async () => {
  const service = createPrintService({
    runner: async () => ({
      stdout: [
        'Duplex/2-Sided Printing: *None DuplexNoTumble DuplexTumble',
        'Option1/Duplexer: *False True',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    }),
  });

  assert.deepEqual(await service.getPrinterStatus('HP-LaserJet-P2015-Series'), {
    queue: 'HP-LaserJet-P2015-Series',
    duplexSupported: false,
  });
});

test('print service submits jobs to lp without touching a real printer in tests', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const service = createPrintService({
    runner: async (command, args) => {
      calls.push({ command, args });
      return { stdout: 'request id is Virtual-PDF-42 (1 file(s))\n', stderr: '', exitCode: 0 };
    },
  });

  assert.deepEqual(await service.submitPdfJob({
    pdfPath: '/tmp/fichas.pdf',
    queue: 'Virtual-PDF',
    copies: 7,
    pageRanges: '1-4',
    sides: 'two-sided-long-edge',
    orientation: 'landscape',
  }), { cupsJobId: 'Virtual-PDF-42' });

  assert.deepEqual(calls, [{
    command: 'lp',
    args: [
      '-d',
      'Virtual-PDF',
      '-n',
      '7',
      '-o',
      'page-ranges=1-4',
      '-o',
      'sides=two-sided-long-edge',
      '-o',
      'orientation-requested=4',
      '/tmp/fichas.pdf',
    ],
  }]);
});

test('print service cleanup removes temporary paths best effort', async () => {
  const removed: string[] = [];
  const service = createPrintService({
    runner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    fileSystem: {
      async rm(path) {
        removed.push(path);
      },
    },
  });

  await service.cleanup(['/tmp/a.pdf', '/tmp/b']);

  assert.deepEqual(removed, ['/tmp/a.pdf', '/tmp/b']);
});
