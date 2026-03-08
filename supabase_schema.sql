-- ============================================================
-- Heckmatt Annotator — Supabase Schema
-- Run this once in Supabase → SQL Editor
-- ============================================================

-- Images table
-- Images are hosted on Cloudinary; we only store the CDN URL here
create table images (
  id              bigint primary key generated always as identity,
  filename        text not null unique,
  cloudinary_url  text not null,          -- full CDN URL from Cloudinary
  cloudinary_id   text not null,          -- public_id for reference
  heckmatt_grade  int not null check (heckmatt_grade between 1 and 4),
  is_annotated    boolean not null default false,
  created_at      timestamptz default now()
);

-- Annotations table
-- yolo_txt stores exactly: "class_id x_center y_center width height"
create table annotations (
  id              bigint primary key generated always as identity,
  image_id        bigint references images(id) on delete cascade,
  x_center        float not null,
  y_center        float not null,
  width           float not null,
  height          float not null,
  heckmatt_grade  int not null,
  yolo_txt        text not null,          -- ready-to-use YOLO line
  created_at      timestamptz default now()
);

-- Index for fast "fetch next unannotated" query
create index idx_images_unannotated on images(is_annotated, created_at)
  where is_annotated = false;
