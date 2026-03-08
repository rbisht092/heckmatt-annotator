import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET() {
  // Fetch annotations joined with image filename + grade (grade determines subfolder)
  const { data, error } = await supabase
    .from('annotations')
    .select('yolo_txt, images(filename, heckmatt_grade)')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return Response.json({ error: 'No annotations yet' }, { status: 404 })
  }

  // Group all yolo lines by image (one image can have multiple boxes = multiple rows)
  const imageMap = {}
  for (const row of data) {
    const filename = row.images?.filename || 'unknown'
    const grade    = row.images?.heckmatt_grade || 1
    const key      = filename
    if (!imageMap[key]) imageMap[key] = { filename, grade, lines: [] }
    imageMap[key].lines.push(row.yolo_txt)
  }

  const zip = new JSZip()

  for (const { filename, grade, lines } of Object.values(imageMap)) {
    // Mirror source folder structure: labels/grade1/img_gmc1_1.txt
    const labelFilename = filename.replace(/\.[^/.]+$/, '') + '.txt'
    const folderPath    = `labels/grade${grade}`
    zip.folder(folderPath).file(labelFilename, lines.join('\n'))
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="labels.zip"',
    },
  })
}
