import ezdxf
from ezdxf import bbox
from rectpack import newPacker
import sys
import os
import math

def buat_nesting_marker(input_path, output_path, lebar_bahan, panjang_bahan, jarak_antar_pola=5.0):
    try:
        doc_asal = ezdxf.readfile(input_path)
    except Exception as e:
        print(f"Gagal membaca file DXF: {e}")
        return

    msp_asal = doc_asal.modelspace()
    daftar_pola = []

    for idx, entity in enumerate(msp_asal):
        if entity.dxftype() in ['LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'SPLINE']:
            ext = bbox.extents([entity])
            if ext.has_data:
                minx, miny = ext.extmin.x, ext.extmin.y
                maxx, maxy = ext.extmax.x, ext.extmax.y
                lebar = (maxx - minx) + jarak_antar_pola
                tinggi = (maxy - miny) + jarak_antar_pola
                
                if lebar > jarak_antar_pola and tinggi > jarak_antar_pola:
                    daftar_pola.append({
                        'id': idx,
                        'entity': entity,
                        'minx': minx,
                        'miny': miny,
                        'w': lebar,
                        'h': tinggi
                    })

    if not daftar_pola:
        print("Tidak ditemukan pola yang valid di dalam file DXF.")
        return

    packer = newPacker(rotation=True)
    for pola in daftar_pola:
        packer.add_rect(pola['w'], pola['h'], rid=pola['id'])

    for _ in range(10):
        packer.add_bin(lebar_bahan, panjang_bahan)

    packer.pack()

    doc_hasil = ezdxf.new()
    msp_hasil = doc_hasil.modelspace()
    
    doc_hasil.layers.add(name="BATAS_BAHAN", color=3)
    doc_hasil.layers.add(name="POLA_NESTING", color=7)

    msp_hasil.add_lwpolyline([
        (0, 0), 
        (lebar_bahan, 0), 
        (lebar_bahan, panjang_bahan), 
        (0, panjang_bahan), 
        (0, 0)
    ], dxfattribs={'layer': 'BATAS_BAHAN'})

    pola_terpasang = 0
    for rect in packer.rect_list():
        bin_idx, x_baru, y_baru, w_baru, h_baru, rid = rect
        if bin_idx > 0:
            print(f"Peringatan: Pola ID {rid} melampaui lembar bahan pertama!")
            
        pola_asli = next(p for p in daftar_pola if p['id'] == rid)
        ent_copy = pola_asli['entity'].copy()
        ent_copy.dxf.layer = 'POLA_NESTING'
        
        ent_copy.translate(-pola_asli['minx'], -pola_asli['miny'], 0)
        
        is_rotated = round(w_baru, 2) != round(pola_asli['w'], 2)
        if is_rotated:
            ent_copy.rotate_z(math.pi / 2)
            tinggi_asli = pola_asli['h'] - jarak_antar_pola
            ent_copy.translate(tinggi_asli, 0, 0)

        margin = jarak_antar_pola / 2.0
        ent_copy.translate(x_baru + margin, y_baru + margin, 0)
        
        msp_hasil.add_entity(ent_copy)
        pola_terpasang += 1

    doc_hasil.saveas(output_path)
    print(f"\n=== NESTING MARKER SELESAI ===")
    print(f"Total pola disusun : {pola_terpasang} dari {len(daftar_pola)} pola")
    print(f"Ukuran bahan       : {lebar_bahan} x {panjang_bahan}")
    print(f"File tersimpan     : {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Cara pakai: python nesting_marker.py <file.dxf> <lebar_bahan> <panjang_bahan> [jarak_pola]")
        sys.exit(1)

    args = sys.argv
    file_in = args[1]
    lebar = float(args[2])
    panjang = float(args[3])
    jarak = float(args[4]) if len(args) > 4 else 5.0

    nama_dasar, ext = os.path.splitext(file_in)
    file_out = f"{nama_dasar}_nesting{ext}"

    buat_nesting_marker(file_in, file_out, lebar, panjang, jarak)
