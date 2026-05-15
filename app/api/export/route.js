import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'

export const dynamic = 'force-dynamic'

function safePathPart(value) {
  return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '_')
}

function labelFilename(filename) {
  return filename.replace(/\.[^/.]+$/, '') + '.txt'
}

export async function GET(request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
    global: {
      fetch: (url, options = {}) =>
        fetch(url, { ...options, cache: 'no-store' }),  // ← new
    },
  }
  )

  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')
  const dataset = searchParams.get('dataset')

  if (mode === 'dataset') {
    if (!dataset) {
      return Response.json({ error: 'Missing dataset' }, { status: 400 })
    }

    const { data: images, error: imagesError } = await supabase
      .from('images')
      .select('id, filename, cloudinary_url, heckmatt_grade, dataset')
      .eq('dataset', dataset)
      .order('filename', { ascending: true })
      .range(0, 99999)

    if (imagesError) return Response.json({ error: imagesError.message }, { status: 500 })
    if (!images || images.length === 0) {
      return Response.json({ error: 'No images found for this dataset' }, { status: 404 })
    }

    const { data: annotations, error: annotationsError } = await supabase
      .from('annotations')
      .select('yolo_txt, images!inner(id, filename, dataset)')
      .eq('images.dataset', dataset)
      .range(0, 99999)

    if (annotationsError) return Response.json({ error: annotationsError.message }, { status: 500 })

    const labelsByImage = new Map()
    for (const row of annotations || []) {
      const filename = row.images?.filename
      if (!filename) continue
      if (!labelsByImage.has(filename)) labelsByImage.set(filename, [])
      labelsByImage.get(filename).push(row.yolo_txt)
    }

    const zip = new JSZip()
    const root = zip.folder(safePathPart(dataset))
    const dataFolder = root.folder('data')
    const yoloFolder = root.folder('yololabels')

    for (const img of images) {
      const gradeFolder = img.heckmatt_grade ? `grade${img.heckmatt_grade}` : 'ungraded'
      try {
        const imageRes = await fetch(img.cloudinary_url, { cache: 'no-store' })
        if (!imageRes.ok) throw new Error(`HTTP ${imageRes.status}`)
        const buffer = Buffer.from(await imageRes.arrayBuffer())
        dataFolder.folder(gradeFolder).file(img.filename, buffer)
      } catch (err) {
        dataFolder.folder(gradeFolder).file(`${img.filename}.download-error.txt`, `Failed to download image: ${err.message}`)
      }

      const lines = labelsByImage.get(img.filename)
      if (lines?.length) {
        yoloFolder.file(labelFilename(img.filename), lines.join('\n'))
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    const zipName = `${safePathPart(dataset)}_dataset.zip`

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
      },
    })
  }

  const { data, error } = await supabase
    .from('annotations')
    .select('yolo_txt, x_center, y_center, images(filename, heckmatt_grade)')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return Response.json({ error: 'No annotations yet' }, { status: 404 })
  }

  // Group all yolo lines by image (one image can have 2 boxes = 2 rows)
  console.log(data)
  const imageMap = {}
  for (const row of data) {
    const filename = row.images?.filename || 'unknown'
    const grade    = row.images?.heckmatt_grade || 1
    if (!imageMap[filename]) imageMap[filename] = { filename, grade, lines: [] }
    imageMap[filename].lines.push(row.yolo_txt)
  }

  const zip = new JSZip()

  for (const { filename, grade, lines } of Object.values(imageMap)) {
    zip.folder(`labels/grade${grade}`).file(labelFilename(filename), lines.join('\n'))
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="labels.zip"',
    },
  })
}
