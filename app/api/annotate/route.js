import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  const body = await request.json()
  const { image_id, boxes, heckmatt_grade, image_filename, is_revisit } = body

  // On revisit: delete old annotations for this image first
  if (is_revisit) {
    const { error: delError } = await supabase
      .from('annotations')
      .delete()
      .eq('image_id', image_id)

    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })
  }

  const class_id = heckmatt_grade - 1  // grade 1→0, 2→1, 3→2, 4→3

  // Insert all boxes
  const rows = boxes.map(b => ({
    image_id,
    x_center: b.x_center,
    y_center: b.y_center,
    width:    b.width,
    height:   b.height,
    heckmatt_grade,
    yolo_txt: `${class_id} ${b.x_center.toFixed(6)} ${b.y_center.toFixed(6)} ${b.width.toFixed(6)} ${b.height.toFixed(6)}`,
  }))

  const { error: insertError } = await supabase
    .from('annotations')
    .insert(rows)

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Mark image as annotated
  const { error: updateError } = await supabase
    .from('images')
    .update({ is_annotated: true })
    .eq('id', image_id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
