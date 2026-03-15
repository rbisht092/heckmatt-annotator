import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const { data, error } = await supabase
    .from('annotations')
    .select('yolo_txt, images(filename, heckmatt_grade)')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return Response.json({ error: 'No annotations yet' }, { status: 404 })
  }

  // Group all yolo lines by image (one image can have 2 boxes = 2 rows)
  const imageMap = {}
  for (const row of data) {
    const filename = row.images?.filename || 'unknown'
    const grade    = row.images?.heckmatt_grade || 1
    if (!imageMap[filename]) imageMap[filename] = { filename, grade, lines: [] }
    imageMap[filename].lines.push(row.yolo_txt)
  }

  const zip = new JSZip()

  for (const { filename, grade, lines } of Object.values(imageMap)) {
    const labelFilename = filename.replace(/\.[^/.]+$/, '') + '.txt'
    zip.folder(`labels/grade${grade}`).file(labelFilename, lines.join('\n'))
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="labels.zip"',
    },
  })
}
