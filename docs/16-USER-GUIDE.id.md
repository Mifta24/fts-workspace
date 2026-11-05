# Panduan Pengguna FTS Workspace

Panduan ini untuk **pengguna** (pemilik workspace, admin, manajer, anggota, dan peninjau). Isinya: apa itu FTS Workspace, cara memulai, cara memakai tiap menu, siapa boleh melakukan apa, dan jawaban untuk pertanyaan yang sering muncul. Tidak perlu pengetahuan teknis.

> Versi ringkas panduan ini juga tersedia di dalam aplikasi pada halaman **Cara pakai** (`/help`), tanpa perlu masuk.
>
> Status: produk masih tahap **pilot**. Pembayaran online belum tersedia, dan beberapa fitur AI hanya aktif jika administrator sudah mengaturnya.

---

## 1. Apa itu FTS Workspace?

Satu tempat kerja bersama untuk tim:

- **Tujuan & tugas** — pecah tujuan besar menjadi langkah kecil, lalu pantau progresnya.
- **Obrolan** — kanal tim dan pesan langsung.
- **Berkas & pengetahuan** — simpan berkas, lalu cari isinya atau tanya asisten AI.
- **Pelanggan** — kontak, deal (pipeline), formulir publik, dan halaman pemesanan jadwal.
- **Progres & poin** — penghargaan sederhana atas tugas yang selesai, supaya tim tetap semangat.

Prinsip utama:

1. **Satu workspace = satu organisasi.** Data sebuah workspace tidak terlihat dari workspace lain.
2. **Peran menentukan apa yang bisa Anda lihat dan ubah.** Menu yang tidak diizinkan untuk peran Anda tidak muncul.
3. **AI hanya membantu, tidak bertindak sendiri.** AI menyusun *draf*; Anda yang meninjau lalu menerapkan.

---

## 2. Mulai cepat (5 langkah)

1. **Buat akun.** Buka halaman utama → **Buat akun**. Isi nama, email, dan kata sandi (minimal **12 karakter**).
2. **Verifikasi email.** Buka tautan yang dikirim ke email Anda. Tanpa ini, Anda tidak bisa masuk.
3. **Buat workspace.** Di halaman **Workspace Anda**, isi *Nama workspace* dan *URL workspace* (huruf kecil, angka, tanda hubung), lalu **Buat workspace**. Anda otomatis menjadi **Pemilik**.
4. **Buat tujuan pertama.** Di **Ringkasan**, klik **Buat tujuan pertama**. Tulis hasil yang ingin dicapai.
5. **Tambah tugas & undang rekan.** Tambah tugas di bawah tujuan itu, lalu undang rekan lewat menu **Anggota**.

Sudah diundang orang lain? Lihat bagian [Menerima undangan](#31-menerima-undangan).

---

## 3. Akun dan workspace

### 3.1 Menerima undangan
1. Buka tautan undangan dari email.
2. **Masuk** (atau **Buat akun**) memakai **alamat email yang sama dengan yang diundang**, lalu buka tautan itu sekali lagi.
3. Klik **Terima undangan**.

Undangan berlaku sementara. Jika muncul "Undangan tidak tersedia", undangan sudah dipakai, dicabut, atau kedaluwarsa — minta undangan baru kepada admin.

### 3.2 Masuk, lupa kata sandi
- **Masuk** dengan email + kata sandi. Pesan "email atau kata sandi salah, atau email belum diverifikasi" bisa berarti salah satunya.
- **Lupa kata sandi?** → masukkan email → klik tautan atur ulang di email (tautan ada masa berlakunya).

### 3.3 Masuk dua langkah (keamanan akun)
Buka **Keamanan** di halaman Workspace Anda.
1. Masukkan kata sandi, klik **Aktifkan**.
2. Di aplikasi autentikator (Google Authenticator, Authy, dll.), pilih *masukkan kunci penyiapan*, tempel **Kunci penyiapan**, lalu ketik kode 6 digit.
3. **Simpan kode pemulihan** di tempat aman. Setiap kode hanya berlaku sekali dan hanya ditampilkan satu kali.

Saat masuk, Anda akan diminta kode dari aplikasi. Ponsel hilang? Pilih **Gunakan kode pemulihan**. Pemilik workspace dapat diwajibkan mengaktifkan ini oleh penyelenggara layanan.

### 3.4 Pindah workspace & bahasa
- Satu akun bisa ada di beberapa workspace. Klik **Ganti workspace** di menu samping.
- Bahasa tersedia: **Indonesia, English, 日本語** (pilihan di halaman utama/ URL `/id`, `/en`, `/ja`).

### 3.5 Menu sederhana vs. lengkap
Secara bawaan menu menampilkan **yang penting saja**: Ringkasan, Proyek, Tujuan, Tugas, Obrolan, Jadwal, Kotak masuk, Progres, Anggota.
Klik **Tampilkan semua fitur** (bawah menu) untuk melihat sisanya (Berkas, Pengetahuan, Asisten, CRM, Formulir, Wawasan, Otomasi, Paket, Pengaturan). Klik **Tampilkan yang penting saja** untuk kembali. Ini hanya pilihan tampilan — tidak mengubah izin Anda.

---

## 4. Memakai tiap menu

### 4.1 Ringkasan (dasbor)
Kartu angka: **Tujuan aktif**, **Tugas saya yang terbuka**, **Tugas selesai**, **Tugas terlambat**, **Progres tugas**. Ada filter proyek, penanggung jawab, dan rentang waktu (7 / 30 / 90 hari, sepanjang waktu) — klik **Terapkan**.
Kartu **Progres saya** menampilkan poin, rentetan hari, dan tantangan Anda sendiri.

### 4.2 Proyek
Wadah untuk mengelompokkan tujuan dan tugas. **Buat proyek** → isi nama (+ deskripsi opsional). Bisa diubah atau **Arsipkan** (khusus Manajer ke atas).

### 4.3 Tujuan
Tujuan bisa bertingkat (tujuan induk → sub-tujuan).

**Membuat tujuan:** isi judul, deskripsi, proyek, tujuan induk, tenggat, lalu pilih **Pelacakan progres**:

| Cara | Progres dihitung dari |
| --- | --- |
| **Dari tugas** | Tugas yang selesai di bawah tujuan ini |
| **Dari tonggak** | Tonggak yang ditandai selesai |
| **KPI numerik** | Nilai saat ini ÷ nilai target |
| **Manual** | Persentase yang Anda isi sendiri |

- **Tonggak** (di halaman tujuan): tambah judul + tenggat, **Tandai selesai**, **Buka kembali**, atau **Hapus**.
- Status tujuan: *Aktif*, *Selesai*, *Diarsipkan*.
- Jika tertulis "Belum ada progres", artinya belum ada tugas/tonggak terkait.

#### Rencanakan tugas dengan AI
Di halaman tujuan klik **Rencanakan tugas dengan AI**:
1. Tulis **Sasaran**. (Hanya judul tujuan, deskripsi, dan teks ini yang dikirim ke AI.)
2. Klik **Buat draf**.
3. **Tinjau draf**: ubah judul/prioritas, hilangkan centang tugas yang tidak diinginkan.
4. Klik **Buat tugas terpilih** — atau **Buang draf**.

Tidak ada tugas yang dibuat sebelum Anda menerapkannya. Estimasi hari hanyalah saran. Jika muncul "belum dikonfigurasi", minta administrator mengaktifkan AI.

### 4.4 Tugas
- **Buat tugas:** judul, deskripsi, penanggung jawab, tujuan, proyek, prioritas, tenggat.
- **Status:** Backlog → Akan dikerjakan → Sedang dikerjakan → Ditinjau → Selesai (atau Dibatalkan).
- **Prioritas:** Rendah, Sedang, Tinggi, Mendesak.
- **Tampilan cepat:** *Semua*, *Untuk saya*, *Terlambat*.
- Buka sebuah tugas untuk **komentar**, **subtugas**, dan mengubah detail.
- Saat tugas ditugaskan kepada Anda atau dikomentari, Anda dapat notifikasi di **Kotak masuk**.

### 4.5 Obrolan
- **Kanal** (untuk seluruh tim, atau **privat/hanya undangan**) dan **Pesan langsung**.
- **Kanal lainnya** → **Gabung** ke kanal publik; **Buat kanal** untuk membuat baru (nama: huruf kecil, angka, tanda hubung).
- Pesan baru muncul langsung (real-time). Tombol **Muat pesan lebih lama** untuk riwayat.
- Anda dapat **Ubah** / **Hapus** pesan sendiri (ditandai *diedit*).
- **Peninjau** hanya bisa membaca, tidak bisa mengirim.

### 4.6 Kotak masuk (notifikasi)
Pemberitahuan: tugas ditugaskan, tugas dikomentari, pesan langsung, undangan/perubahan/pembatalan rapat, pengingat rapat, tugas hampir jatuh tempo, pemesanan baru, formulir terisi. Klik **Tandai dibaca** atau **Tandai semua dibaca**. Angka di menu = jumlah yang belum dibaca.

### 4.7 Progres & poin
- Poin diberikan untuk **tugas yang ditugaskan kepada Anda dan Anda selesaikan**, dengan **batas harian**. Poin **bukan uang** dan tidak bisa ditukar.
- Anda melihat: **Total poin**, **7 hari terakhir**, **Rentetan hari**, **Poin hari ini**.
- **Tantangan:** target jumlah tugas selesai dalam periode tertentu (Akan datang / Berjalan / Selesai).
- **Papan peringkat:** *opsional*. Hanya tampil jika pemilik/admin mengaktifkannya, dan hanya anggota yang memilih **Tampilkan saya di papan peringkat** yang muncul. Anda bisa menyembunyikan diri kapan saja.
- Manajer ke atas dapat **Buat tantangan**; Pemilik/Admin mengatur kebijakan papan peringkat.

### 4.8 Berkas
- **Unggah berkas:** teks, Markdown, CSV, PDF, PNG, JPEG, atau WebP — **maksimal 10 MB**.
- Pilih **Siapa yang dapat melihat**:
  - *Hanya saya*
  - *Saya dan orang yang saya pilih* (gunakan **Kelola akses** → **Bagikan**)
  - *Semua orang di workspace*
- Untuk berkas teks, klik **Tambahkan ke pengetahuan** agar bisa dicari (lihat berikut).

### 4.9 Pengetahuan
Kotak pencarian untuk isi berkas yang sudah ditambahkan ke basis pengetahuan. Ketik minimal 2 karakter → **Cari**. Anda hanya melihat kutipan dari berkas yang **boleh Anda baca**. Status pengindeksan: *Menunggu pekerja latar belakang* → *Terindeks* (atau *Pengindeksan gagal*). Berkas baru butuh waktu singkat sebelum bisa dicari.

### 4.10 Asisten (AI)
Ajukan pertanyaan; asisten menjawab **hanya dari berkas yang boleh Anda baca**, lengkap dengan **sumber**.
- Jawaban dibuat AI dan **bisa keliru** — periksa sumbernya.
- Jika tidak ada kutipan yang cocok, tidak ada yang dikirim ke AI.
- Ada **anggaran token harian**; jika habis, fitur AI berhenti sampai reset (UTC). Pemilik/Admin dapat mengaturnya (0 = AI mati).

### 4.11 CRM (pelanggan)
- **Kontak:** nama, perusahaan, email, telepon. Kontak berisi data pribadi orang luar — **catat persetujuan** (Belum dicatat / Diberikan / Dicabut) dan **bagaimana** persetujuan diperoleh (mis. "formulir web").
- Anggota biasa melihat **kontak miliknya**; Manajer ke atas melihat **semua kontak**.
- **Deal & pipeline:** Prospek → Terkualifikasi → Proposal → Negosiasi → Menang / Kalah. Pakai **Pindah** untuk mengubah tahap. Nilai tidak dijumlahkan lintas mata uang.
- **Perjalanan pelanggan:** Lead → Prospek → Pelanggan → Tidak aktif.
- **Aktivitas:** catat Catatan, Telepon, Email, atau Pertemuan.
- **Hapus data pribadi** (Pemilik/Admin): menghapus nama, email, telepon, perusahaan, dan teks aktivitas. Deal dan bukti persetujuan tetap ada. **Tidak dapat dibatalkan.**

### 4.12 Jadwal
- Menampilkan rapat Anda **60 hari ke depan**, dalam **zona waktu Anda** (bisa disimpan di bagian *Zona waktu Anda*).
- **Rapat baru:** judul, waktu mulai, durasi, lokasi/tautan, kontak terkait, undangan, pengingat. Tidak bisa dobel-pesan: orang yang belum menolak dianggap sibuk.
- Peserta bisa **Terima** / **Tolak**; penyelenggara bisa **Jadwalkan ulang** / **Batalkan rapat**.
- **Langganan kalender:** **Buat tautan** pribadi untuk Google Calendar / Apple Calendar / Outlook. Tautan hanya ditampilkan **sekali** dan berisi detail rapat — jangan dibagikan. **Matikan** untuk mencabutnya.

### 4.13 Halaman pemesanan (booking)
Dari Jadwal → **Halaman pemesanan**. Biarkan orang luar memesan waktu kosong Anda lewat tautan publik.
1. **Buat halaman pemesanan**: judul, lama rapat, hari & jam menerima, pemberitahuan minimum, berapa hari ke depan, pernyataan persetujuan.
2. (Opsional) **Hubungkan Google Calendar** agar waktu sibuk Anda otomatis dilewati (hanya jam sibuk yang dibaca, bukan judul acara).
3. **Terbitkan** → bagikan tautannya. **Tutup halaman** untuk menghentikan.

Pengunjung memilih waktu, mengisi nama/email, lalu **Pesan waktu ini**; mereka bisa membatalkan lewat tautan di email. Setiap pemesanan membuat/menautkan kontak CRM dan muncul di jadwal Anda. Hanya Anda yang dapat mengelola halaman Anda.

### 4.14 Formulir (Manajer ke atas)
1. **Formulir baru** → pilih templat (*Permintaan kontak*, *Pendaftaran acara*, *Umpan balik anonim*).
2. Atur **kolom** (teks pendek, email, telepon, teks panjang, pilihan), tandai *wajib*, dan tulis **pernyataan persetujuan**.
3. **Terbitkan** → bagikan tautan publik. **Tutup formulir** untuk menghentikan (bisa diterbitkan lagi).
4. Lihat **Kiriman**; yang membuat kontak otomatis terhubung ke CRM.

Setelah diterbitkan, kolom tidak bisa ditambah/dihapus — hanya labelnya yang bisa diubah, agar jawaban lama tetap cocok.

### 4.15 Wawasan
Ringkasan angka (bukan nama/jawaban): kontak baru, status persetujuan, kiriman formulir, dan rapat Anda — untuk **7, 30, atau 90 hari** dibanding periode sebelumnya.

### 4.16 Otomasi (Pemilik/Admin)
Tiga aturan kecil yang **mati sampai Anda menyalakannya**: (1) beri tahu pemilik formulir tentang isian baru, (2) buat tugas tindak lanjut untuk tiap isian, (3) catat pemesanan baru di kontak. Hanya bekerja di dalam workspace — tidak mengirim email keluar dan tidak menghapus apa pun. Perubahan hanya berlaku untuk kejadian baru.

### 4.17 Anggota
- Semua peran bisa melihat daftar anggota.
- **Pemilik/Admin:** **Undang seseorang** (email + peran) → **Kirim undangan**. Lihat *Undangan tertunda*, **Cabut** bila perlu. Undangan menahan satu "kursi" sampai diterima/dicabut/kedaluwarsa.

### 4.18 Paket (Pemilik/Admin)
Melihat paket (**Gratis / Tim / Bisnis**), pemakaian kursi, penyimpanan, token AI, dan fitur yang termasuk. Perubahan paket saat ini dilakukan **operator platform** — hubungi mereka. Pindah ke paket lebih kecil **tidak menghapus data**.

| Paket | Anggota | Penyimpanan | Catatan |
| --- | --- | --- | --- |
| Gratis | hingga 5 | 200 MB | Tujuan, proyek, tugas, kolaborasi |
| Tim | hingga 25 | 5 GB | + CRM, formulir publik, halaman pemesanan |
| Bisnis | hingga 250 | 100 GB | Kapasitas lebih besar |

*(Harga di halaman utama adalah usulan pilot, bukan penawaran komersial.)*

### 4.19 Pengaturan (Pemilik)
**Hapus workspace:** ketik URL workspace → **Minta penghapusan**. Ada masa tenggang **14 hari**; selama itu workspace tetap berfungsi dan bisa dibatalkan lewat **Batalkan penghapusan**. Setelah itu data dihapus permanen. Butuh salinan data? Hubungi penyelenggara sebelum 14 hari berlalu (belum ada tombol ekspor).

---

## 5. Siapa boleh melakukan apa?

| Kemampuan | Pemilik | Admin | Manajer | Anggota | Peninjau |
| --- | :-: | :-: | :-: | :-: | :-: |
| Melihat proyek, tujuan, tugas, dasbor, obrolan, berkas yang dibagikan | ✔ | ✔ | ✔ | ✔ | ✔ |
| Membuat/ubah tujuan & tugas, komentar | ✔ | ✔ | ✔ | ✔ | — |
| Mengirim pesan obrolan | ✔ | ✔ | ✔ | ✔ | — |
| Unggah berkas, kelola pengetahuan | ✔ | ✔ | ✔ | ✔ | — |
| Memakai AI (perencana & asisten) | ✔ | ✔ | ✔ | ✔ | — |
| CRM (kontak sendiri) & jadwal/rapat | ✔ | ✔ | ✔ | ✔ | jadwal: lihat saja |
| Halaman pemesanan | ✔ | ✔ | ✔ | ✔ | — |
| Membuat/arsipkan proyek; arsipkan tujuan | ✔ | ✔ | ✔ | — | — |
| Melihat **semua** kontak CRM | ✔ | ✔ | ✔ | — | — |
| Formulir, tantangan, kelola kanal | ✔ | ✔ | ✔ | — | — |
| Undang/ubah peran/keluarkan anggota; jejak audit | ✔ | ✔ | — | — | — |
| Otomasi, Paket, hapus data pribadi CRM, moderasi obrolan | ✔ | ✔ | — | — | — |
| Hapus berkas siapa pun | ✔ | ✔ | — | — | — |
| Ubah pengaturan organisasi/kebijakan papan peringkat | ✔ | ✔ | — | — | — |
| Hapus workspace | ✔ | — | — | — | — |

Tidak melihat sebuah menu? Biasanya karena peran Anda memang tidak memilikinya. Minta Pemilik/Admin mengubah peran Anda bila perlu.

---

## 6. Halaman publik untuk orang luar

Orang di luar tim **tidak perlu akun**:
- **Formulir publik** (`/f/<token>`): isi, setujui pernyataan persetujuan bila ada, klik **Kirim**.
- **Halaman pemesanan** (`/b/<token>`): pilih zona waktu → **Tampilkan waktu** → pilih slot → isi data → **Pesan waktu ini**. Untuk membatalkan, pakai tautan pembatalan.

Jawaban dikirim ke organisasi yang menerbitkan halaman tersebut.

---

## 7. Privasi dan keamanan singkat

- Data dibatasi per workspace; peran dan izin tiap item mengatur akses.
- AI memakai batas akses yang sama dengan Anda dan hanya menghasilkan **draf** atau **jawaban bersumber**.
- Pakai kata sandi unik yang kuat dan aktifkan **masuk dua langkah**.
- Jangan memasukkan data sensitif khusus (mis. data kartu pembayaran) ke dalam workspace.
- Ketentuan dan pemberitahuan privasi tersedia di footer halaman (**Ketentuan penggunaan**, **Privasi**).

---

## 8. Tanya jawab & pemecahan masalah

**Saya tidak menerima email verifikasi / undangan / reset.** Periksa folder spam. Jika tetap tidak datang, hubungi administrator — pengiriman email harus diatur di server.

**Tautan undangan bilang "tidak tersedia".** Sudah dipakai, dicabut, atau kedaluwarsa. Minta undangan baru. Pastikan masuk dengan email yang diundang.

**Menu Formulir/Otomasi/Paket/Asisten tidak ada.** Menu ini bergantung peran (lihat bagian 5) dan, untuk menu lengkap, klik **Tampilkan semua fitur**.

**"Perencanaan AI / Asisten belum dikonfigurasi."** Administrator server belum mengatur penyedia model AI. Fitur lain tetap berjalan.

**Asisten bilang tidak ada sumber.** Belum ada berkas teks yang ditambahkan ke pengetahuan, atau Anda tidak berhak membacanya. Unggah di **Berkas** → **Tambahkan ke pengetahuan**, tunggu status *Terindeks*.

**Berkas gagal diunggah.** Periksa tipe (teks, Markdown, CSV, PDF, PNG, JPEG, WebP), ukuran ≤ 10 MB, dan kuota penyimpanan paket.

**Tidak bisa menambah anggota/berkas lagi.** Batas paket tercapai; hubungi operator platform untuk menaikkan paket.

**Poin saya tidak bertambah.** Poin hanya untuk tugas yang *ditugaskan kepada Anda* dan *Anda selesaikan*, dengan batas harian.

**Saya kehilangan akses autentikator.** Masuk memakai **kode pemulihan**, lalu buat kode pemulihan baru di **Keamanan**.

**Workspace saya "ditangguhkan" atau ada spanduk penghapusan.** Penangguhan dilakukan operator platform. Spanduk penghapusan berarti Pemilik meminta penghapusan; Pemilik bisa membatalkannya di **Pengaturan** sebelum tanggal yang tertera.

---

## 9. Untuk pengelola server (ringkas)

Cara menjalankan secara lokal (detail ada di `README.md` dan `docs/12-OPERATIONS.md`):

```bash
pnpm install
cp .env.example .env            # isi BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d postgres   # atau: pnpm db:local
pnpm db:deploy                  # terapkan migrasi
pnpm db:seed                    # opsional: data demo
pnpm dev                        # http://localhost:3000
pnpm worker                     # pengindeks berkas (agar Pengetahuan/Asisten bekerja)
pnpm gateway                    # obrolan real-time (port 4000)
```

Di lingkungan pengembangan, tautan email (verifikasi/undangan/reset) dicetak di log server dengan awalan `[dev email]`.

Dokumen terkait: `docs/04-FEATURES.md` (spesifikasi fitur), `docs/07-SECURITY.md` (keamanan), `docs/14-PILOT.md` (pilot), `docs/12-OPERATIONS.md` (operasional).
