from __future__ import annotations

import json
import os
import sys

from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption


def build_pdf_converter() -> DocumentConverter:
    pipeline_options = PdfPipelineOptions()

    # Use CPU in worker to reduce runtime instability on headless macOS contexts.
    pipeline_options.accelerator_options = AcceleratorOptions(
        device=AcceleratorDevice.CPU,
        num_threads=2,
    )

    # Most SEC exhibits are digital PDFs; OCR is expensive and can introduce extra runtime deps.
    pipeline_options.do_ocr = False

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )


def main() -> int:
    if len(sys.argv) != 3:
        return 2

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    converter = build_pdf_converter()
    result = converter.convert(input_path)

    payload = {
        "markdown": result.document.export_to_markdown(),
        "docling_json": result.document.export_to_dict(),
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
