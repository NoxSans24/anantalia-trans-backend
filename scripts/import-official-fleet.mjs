import { createPrismaClient } from '../src/lib/prisma.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CATEGORIES = [
  {
    slug: 'city-car-ev',
    name: 'City Car / EV',
    sortOrder: 1,
    description: 'Kendaraan perkotaan lincah, hemat energi, dan mobil listrik (EV).',
  },
  {
    slug: 'mpv-standar',
    name: 'MPV Standar',
    sortOrder: 2,
    description: 'MPV keluarga ekonomis dan nyaman untuk mobilitas harian hingga antarkota.',
  },
  {
    slug: 'mpv-keluarga',
    name: 'MPV Keluarga',
    sortOrder: 3,
    description: 'MPV kabin lega dengan fitur keselamatan lengkap untuk perjalanan keluarga.',
  },
  {
    slug: 'premium',
    name: 'Premium',
    sortOrder: 4,
    description: 'Armada kelas eksekutif, SUV tangguh, dan MPV luxury untuk kebutuhan VIP.',
  },
  {
    slug: 'minibus',
    name: 'Minibus',
    sortOrder: 5,
    description: 'Minibus berkapasitas besar untuk rombongan keluarga, shuttle, dan wisata.',
  },
  {
    slug: 'bus-medium',
    name: 'Bus Medium',
    sortOrder: 6,
    description: 'Kendaraan rombongan kapasitas besar untuk pariwisata dan perjalanan korporasi.',
  },
];

const SELF_DRIVE_CATEGORIES = new Set(['City Car / EV', 'MPV Standar', 'MPV Keluarga']);

// Official 61-model fleet catalog sourced from Data_Mobil_dan_Alamat.xlsx
const OFFICIAL_VEHICLES = [
  {
    name: 'Toyota Calya',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan penggunaan harian',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS pada varian tertentu, AC, ISOFIX',
  },
  {
    name: 'Toyota Grand New Avanza',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan dalam kota/luar kota',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS/EBD pada varian tertentu, AC, power window',
  },
  {
    name: 'Daihatsu Sigra',
    category: 'MPV Standar',
    usage: 'Mobil keluarga hemat biaya dan operasional harian',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag pada varian tertentu, ABS, AC, sensor parkir',
  },
  {
    name: 'Daihatsu New Sigra',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan penggunaan harian',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS pada varian tertentu, AC, sensor parkir',
  },
  {
    name: 'Toyota New Calya',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan harian',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS, AC, head unit layar sentuh pada varian tertentu',
  },
  {
    name: 'Toyota Agya',
    category: 'City Car / EV',
    usage: 'Kendaraan perkotaan dan penggunaan harian',
    capacity: '5 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS/EBD, Vehicle Stability Control pada varian tertentu',
  },
  {
    name: 'Toyota New Avanza 2019',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan antarkota',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS/EBD, Hill Start Assist pada varian tertentu',
  },
  {
    name: 'Daihatsu All New Xenia 2022',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan jarak jauh',
    capacity: '7 penumpang',
    transmission: 'Manual / CVT',
    fuel: 'Bensin',
    features: 'ASA pada varian tertentu, VSC, HSA, ABS, dual airbag',
  },
  {
    name: 'Toyota All New Avanza 2022',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan antarkota',
    capacity: '7 penumpang',
    transmission: 'Manual / CVT',
    fuel: 'Bensin',
    features: 'Toyota Safety Sense pada varian tertentu, VSC, HSA, ABS, dual airbag',
  },
  {
    name: 'Daihatsu Ayla',
    category: 'City Car / EV',
    usage: 'Kendaraan perkotaan yang praktis dan ekonomis',
    capacity: '5 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag pada varian tertentu, ABS, sensor parkir',
  },
  {
    name: 'Daihatsu New Xenia',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan kebutuhan mobilitas harian',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS, AC, fitur hiburan',
  },
  {
    name: 'Daihatsu Grand New Xenia',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan antarkota',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag pada varian tertentu, ABS, AC, audio system',
  },
  {
    name: 'Suzuki Ertiga',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan jarak menengah',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS/EBD, ESP pada varian tertentu, AC',
  },
  {
    name: 'Daihatsu Xenia',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan operasional sehari-hari',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'AC, power window, dual airbag dan ABS pada varian tertentu',
  },
  {
    name: 'Mitsubishi Xpander',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan antarkota',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS/EBD, Active Stability Control, Hill Start Assist',
  },
  {
    name: 'Suzuki All New Ertiga',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan jarak jauh',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'HEARTECT, dual airbag, ABS/EBD, ESP pada varian tertentu',
  },
  {
    name: 'Toyota All New Rush',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan dengan kondisi jalan beragam',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: '6 SRS Airbag pada varian tertentu, VSC, HSA, ABS, kamera parkir',
  },
  {
    name: 'Daihatsu All New Terios',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan luar kota',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS, VSC pada varian tertentu, kamera parkir',
  },
  {
    name: 'Wuling Confero S',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan angkutan penumpang',
    capacity: '7–8 penumpang',
    transmission: 'Manual',
    fuel: 'Bensin',
    features: 'ABS/EBD, dual airbag pada varian tertentu, TPMS pada varian tertentu',
  },
  {
    name: 'Honda Mobilio',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan penggunaan harian',
    capacity: '7 penumpang',
    transmission: 'Manual / CVT',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS/EBD, Vehicle Stability Assist pada varian tertentu',
  },
  {
    name: 'Mitsubishi Xpander Facelift 2021',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan antarkota',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Active Stability Control, Hill Start Assist, ABS/EBD, dual airbag',
  },
  {
    name: 'Nissan All New Livina',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan harian',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Dual SRS Airbag, ABS/EBD, Vehicle Dynamic Control pada varian tertentu',
  },
  {
    name: 'Suzuki XL7',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan di berbagai kondisi jalan',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'ESP, Hill Hold Control, ABS/EBD, dual airbag, Smart E-Mirror pada varian tertentu',
  },
  {
    name: 'Hyundai Stargazer',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan antarkota',
    capacity: '7 penumpang',
    transmission: 'Manual / IVT',
    fuel: 'Bensin',
    features: 'Hyundai SmartSense pada varian tertentu, 6 airbag pada varian tertentu, kamera belakang',
  },
  {
    name: 'Mitsubishi Xpander Cross',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan dengan kondisi jalan beragam',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin',
    features: 'Active Stability Control, Hill Start Assist, ABS/EBD, kamera belakang',
  },
  {
    name: 'Toyota Innova Reborn',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga, perjalanan jauh, dan operasional bisnis',
    capacity: '7–8 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin / Diesel',
    features: 'ABS, dual airbag, Vehicle Stability Control pada varian tertentu',
  },
  {
    name: 'Toyota New Innova Reborn Facelift',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan jarak jauh',
    capacity: '7–8 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin / Diesel',
    features: 'ABS, dual airbag, Vehicle Stability Control pada varian tertentu, head unit layar sentuh',
  },
  {
    name: 'Toyota Grand New Innova',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan kebutuhan transportasi antarkota',
    capacity: '7–8 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin / Diesel',
    features: 'ABS, dual airbag, AC, fitur hiburan',
  },
  {
    name: 'Toyota Raize',
    category: 'City Car / EV',
    usage: 'Mobil perkotaan dan perjalanan keluarga kecil',
    capacity: '5 penumpang',
    transmission: 'Manual / CVT',
    fuel: 'Bensin',
    features: 'Toyota Safety Sense pada varian tertentu, VSC, HSA, kamera parkir',
  },
  {
    name: 'Wuling BinguoEV',
    category: 'City Car / EV',
    usage: 'Mobilitas perkotaan tanpa emisi gas buang dari knalpot',
    capacity: '5 penumpang',
    transmission: 'Otomatis (single-speed)',
    fuel: 'Listrik (BEV)',
    features: 'Layar infotainment, kamera 360 pada varian tertentu, ABS, ESC',
  },
  {
    name: 'Wuling Cloud EV',
    category: 'City Car / EV',
    usage: 'Mobilitas perkotaan dan keluarga kecil',
    capacity: '5 penumpang',
    transmission: 'Otomatis (single-speed)',
    fuel: 'Listrik (BEV)',
    features: 'ADAS pada varian tertentu, kamera 360, layar infotainment, ESC',
  },
  {
    name: 'Toyota All New Innova Zenix',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan jarak jauh',
    capacity: '7 penumpang',
    transmission: 'CVT',
    fuel: 'Bensin / Hybrid',
    features: 'Toyota Safety Sense pada varian tertentu, 6 airbag, VSC, panoramic roof pada varian tertentu',
  },
  {
    name: 'BYD M6',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan antarkota berbasis listrik',
    capacity: '6–7 penumpang',
    transmission: 'Otomatis (single-speed)',
    fuel: 'Listrik (BEV)',
    features: 'DiLink infotainment, ADAS pada varian tertentu, 6 airbag, V2L',
  },
  {
    name: 'Toyota All New Innova Zenix Hybrid',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dengan efisiensi bahan bakar lebih baik',
    capacity: '7 penumpang',
    transmission: 'CVT (e-CVT)',
    fuel: 'Hybrid bensin-listrik',
    features: 'Toyota Safety Sense pada varian tertentu, 6 airbag, VSC, mode berkendara',
  },
  {
    name: 'Toyota Fortuner 2019',
    category: 'Premium',
    usage: 'Mobil keluarga, perjalanan jauh, dan medan beragam',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin / Diesel',
    features: 'ABS, Vehicle Stability Control, Hill Assist Control, airbag',
  },
  {
    name: 'Toyota New Fortuner VRZ',
    category: 'Premium',
    usage: 'Mobil keluarga dan perjalanan di berbagai medan',
    capacity: '7 penumpang',
    transmission: 'Otomatis',
    fuel: 'Diesel',
    features: 'Toyota Safety Sense pada model terbaru tertentu, VSC, HSA, ABS, airbag',
  },
  {
    name: 'Hyundai H-1',
    category: 'Minibus',
    usage: 'Transportasi keluarga besar, rombongan, dan eksekutif',
    capacity: '7–12 penumpang (tergantung varian)',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin / Diesel',
    features: 'AC multi-zone pada varian tertentu, dual airbag, ABS, pintu geser',
  },
  {
    name: 'Toyota HiAce Premio',
    category: 'Minibus',
    usage: 'Transportasi pariwisata, shuttle, dan rombongan',
    capacity: '12–14 penumpang (tergantung konfigurasi)',
    transmission: 'Manual',
    fuel: 'Diesel',
    features: 'ABS, dual airbag, AC penumpang, pintu geser',
  },
  {
    name: 'Toyota Grand New Fortuner',
    category: 'Premium',
    usage: 'Mobil keluarga, perjalanan jauh, dan medan beragam',
    capacity: '7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin / Diesel',
    features: 'VSC, HSA, ABS, airbag, sistem audio',
  },
  {
    name: 'Mitsubishi All New Pajero',
    category: 'Premium',
    usage: 'Perjalanan keluarga, touring, dan medan berat',
    capacity: '7 penumpang',
    transmission: 'Otomatis',
    fuel: 'Diesel',
    features: 'Super Select 4WD-II pada varian tertentu, ASTC, ABS, airbag',
  },
  {
    name: 'Toyota New Fortuner GR 2023',
    category: 'Premium',
    usage: 'Mobil keluarga, touring, dan perjalanan luar kota',
    capacity: '7 penumpang',
    transmission: 'Otomatis',
    fuel: 'Diesel',
    features: 'Toyota Safety Sense pada varian tertentu, GR styling, VSC, HSA, ABS',
  },
  {
    name: 'Toyota All New Camry',
    category: 'Premium',
    usage: 'Kendaraan eksekutif dan perjalanan nyaman',
    capacity: '5 penumpang',
    transmission: 'Otomatis (CVT / e-CVT)',
    fuel: 'Bensin / Hybrid',
    features: 'Toyota Safety Sense, 8 airbag pada varian tertentu, kamera parkir, layar infotainment',
  },
  {
    name: 'BYD Denza D9',
    category: 'Premium',
    usage: 'Transportasi premium keluarga dan eksekutif',
    capacity: '7 penumpang',
    transmission: 'Otomatis (single-speed / hybrid)',
    fuel: 'Listrik (BEV) / Plug-in Hybrid',
    features: 'ADAS, layar hiburan, kursi captain seat, pintu geser elektrik',
  },
  {
    name: 'Toyota All New Alphard',
    category: 'Premium',
    usage: 'Transportasi keluarga premium dan eksekutif',
    capacity: '7 penumpang',
    transmission: 'Otomatis (CVT / e-CVT)',
    fuel: 'Bensin / Hybrid',
    features: 'Toyota Safety Sense, captain seat, pintu geser elektrik, panoramic roof pada varian tertentu',
  },
  {
    name: 'Toyota HiAce Premio Luxury',
    category: 'Minibus',
    usage: 'Transportasi rombongan dan perjalanan eksekutif',
    capacity: '8–10 penumpang (tergantung modifikasi)',
    transmission: 'Manual',
    fuel: 'Diesel',
    features: 'Kursi penumpang premium, AC penumpang, ABS, dual airbag',
  },
  {
    name: 'Toyota New Alphard 2024 Hybrid',
    category: 'Premium',
    usage: 'Transportasi keluarga premium dan eksekutif',
    capacity: '7 penumpang',
    transmission: 'Otomatis (e-CVT)',
    fuel: 'Hybrid bensin-listrik',
    features: 'Toyota Safety Sense, captain seat, pintu geser elektrik, panoramic roof',
  },
  {
    name: 'Toyota HiAce Commuter',
    category: 'Minibus',
    usage: 'Transportasi pariwisata, shuttle, dan rombongan',
    capacity: 'hingga 16 penumpang (tergantung konfigurasi)',
    transmission: 'Manual',
    fuel: 'Diesel',
    features: 'AC penumpang, ABS, dual airbag, kursi baris penumpang',
  },
  {
    name: 'Toyota All New Alphard Transformer',
    category: 'Premium',
    usage: 'Transportasi keluarga premium dan eksekutif',
    capacity: '7 penumpang',
    transmission: 'Otomatis (CVT)',
    fuel: 'Bensin',
    features: 'Captain seat, pintu geser elektrik, power back door pada varian tertentu, airbag',
  },
  {
    name: 'Toyota All New Alphard Transformer 2022',
    category: 'Premium',
    usage: 'Transportasi keluarga premium dan eksekutif',
    capacity: '7 penumpang',
    transmission: 'Otomatis (CVT)',
    fuel: 'Bensin / Hybrid',
    features: 'Captain seat, pintu geser elektrik, Toyota Safety Sense pada varian tertentu',
  },
  {
    name: 'Wuling Confero DB',
    category: 'MPV Standar',
    usage: 'Transportasi keluarga dan angkutan penumpang',
    capacity: '7–8 penumpang',
    transmission: 'Manual',
    fuel: 'Bensin',
    features: 'AC, power window, ABS/EBD pada varian tertentu',
  },
  {
    name: 'Chevrolet Spin',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan harian',
    capacity: '5–7 penumpang',
    transmission: 'Manual / Otomatis',
    fuel: 'Bensin / Diesel',
    features: 'Dual airbag, ABS pada varian tertentu, AC, ISOFIX',
  },
  {
    name: 'BYD Atto 1',
    category: 'City Car / EV',
    usage: 'Mobilitas perkotaan dan perjalanan harian',
    capacity: '5 penumpang',
    transmission: 'Otomatis (single-speed)',
    fuel: 'Listrik (BEV)',
    features: 'Layar infotainment, kamera belakang, ABS, ESC (fitur tergantung varian/pasar)',
  },
  {
    name: 'Toyota All New Veloz 2021',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan antarkota',
    capacity: '7 penumpang',
    transmission: 'Manual / CVT',
    fuel: 'Bensin',
    features: 'Toyota Safety Sense pada varian tertentu, VSC, HSA, ABS, airbag',
  },
  {
    name: 'Toyota Veloz 2022',
    category: 'MPV Standar',
    usage: 'Mobil keluarga dan perjalanan jarak jauh',
    capacity: '7 penumpang',
    transmission: 'Manual / CVT',
    fuel: 'Bensin',
    features: 'Toyota Safety Sense pada varian tertentu, VSC, HSA, ABS, airbag',
  },
  {
    name: 'VinFast VF e34',
    category: 'City Car / EV',
    usage: 'Mobilitas perkotaan dan perjalanan keluarga kecil',
    capacity: '5 penumpang',
    transmission: 'Otomatis (single-speed)',
    fuel: 'Listrik (BEV)',
    features: 'Layar infotainment, konektivitas aplikasi, ABS, ESC, airbag',
  },
  {
    name: 'Aletra L8 EV',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan antarkota berbasis listrik',
    capacity: '7 penumpang',
    transmission: 'Otomatis (single-speed)',
    fuel: 'Listrik (BEV)',
    features: 'Layar infotainment, kamera parkir, fitur keselamatan aktif (tergantung varian)',
  },
  {
    name: 'Toyota Voxy',
    category: 'MPV Keluarga',
    usage: 'Mobil keluarga dan perjalanan nyaman',
    capacity: '7 penumpang',
    transmission: 'Otomatis (CVT)',
    fuel: 'Bensin / Hybrid (tergantung generasi/pasar)',
    features: 'Pintu geser elektrik, Toyota Safety Sense pada varian tertentu, captain seat',
  },
  {
    name: 'Mitsubishi New Pajero Dakar',
    category: 'Premium',
    usage: 'Mobil keluarga, touring, dan medan berat',
    capacity: '7 penumpang',
    transmission: 'Otomatis',
    fuel: 'Diesel',
    features: 'Super Select 4WD-II pada varian tertentu, ASTC, ABS, airbag',
  },
  {
    name: 'Toyota New Vellfire',
    category: 'Premium',
    usage: 'Transportasi keluarga premium dan eksekutif',
    capacity: '7 penumpang',
    transmission: 'Otomatis (CVT / e-CVT)',
    fuel: 'Bensin / Hybrid',
    features: 'Toyota Safety Sense, captain seat, pintu geser elektrik, fitur hiburan belakang',
  },
  {
    name: 'Isuzu ELF Long 19 Seat',
    category: 'Bus Medium',
    usage: 'Transportasi penumpang, pariwisata, dan shuttle',
    capacity: '19 penumpang',
    transmission: 'Manual',
    fuel: 'Diesel',
    features: 'Rem ABS pada varian tertentu, AC penumpang (sesuai bodi), sabuk pengaman',
  },
  {
    name: 'Toyota Land Cruiser',
    category: 'Premium',
    usage: 'Perjalanan jarak jauh dan medan berat/off-road',
    capacity: '7 penumpang',
    transmission: 'Otomatis',
    fuel: 'Diesel / Bensin (tergantung generasi/pasar)',
    features: 'Sistem 4WD, Multi-Terrain Select pada varian tertentu, Toyota Safety Sense, airbag',
  },
];

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function parseSeatCount(capacityText) {
  const numbers = [...String(capacityText).matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!numbers.length) {
    throw new Error(`Could not parse seat count from "${capacityText}"`);
  }
  const seatCount = Math.max(...numbers);
  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 200) {
    throw new Error(`Invalid seat count ${seatCount} from "${capacityText}"`);
  }
  return seatCount;
}

function parseFeatures(featuresText) {
  return String(featuresText)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function prepareRecords() {
  const categoryMap = new Map(CATEGORIES.map((c) => [c.name, c]));
  const seenSlugs = new Set();

  const prepared = OFFICIAL_VEHICLES.map((item) => {
    const category = categoryMap.get(item.category);
    if (!category) throw new Error(`Unknown category "${item.category}" for "${item.name}"`);

    const slug = toSlug(item.name);
    if (!SLUG_PATTERN.test(slug)) throw new Error(`Invalid slug "${slug}" for "${item.name}"`);
    if (seenSlugs.has(slug)) throw new Error(`Duplicate slug "${slug}"`);
    seenSlugs.add(slug);

    const seatCount = parseSeatCount(item.capacity);
    const features = parseFeatures(item.features);
    const publicSpecs = {
      transmission: item.transmission.trim(),
      fuel: item.fuel.trim(),
      features,
      capacityLabel: item.capacity.trim(),
    };

    if (Buffer.byteLength(JSON.stringify(publicSpecs), 'utf8') > 5000) {
      throw new Error(`publicSpecs too large for "${item.name}"`);
    }

    return {
      slug,
      name: item.name.trim(),
      categorySlug: category.slug,
      categoryName: category.name,
      description: item.usage.trim(),
      seatCount,
      publicSpecs,
      allowSelfDrive: SELF_DRIVE_CATEGORIES.has(category.name),
    };
  });

  if (prepared.length !== 61) {
    throw new Error(`Expected 61 vehicle records, got ${prepared.length}`);
  }
  return prepared;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const prepared = prepareRecords();

  if (isDryRun) {
    const perCategory = {};
    for (const item of prepared) {
      perCategory[item.categoryName] = (perCategory[item.categoryName] ?? 0) + 1;
    }
    console.log(JSON.stringify({
      mode: 'dry-run',
      categoriesCount: CATEGORIES.length,
      vehiclesCount: prepared.length,
      perCategory,
      sample: prepared.slice(0, 3),
    }, null, 2));
    return;
  }

  const prisma = createPrismaClient(process.env.DATABASE_URL);
  try {
    const categoryIdBySlug = new Map();
    let categoriesUpserted = 0;

    for (const cat of CATEGORIES) {
      const saved = await prisma.vehicleCategory.upsert({
        where: { slug: cat.slug },
        create: {
          slug: cat.slug,
          name: cat.name,
          description: cat.description,
          sortOrder: cat.sortOrder,
          isActive: true,
        },
        update: {
          name: cat.name,
          description: cat.description,
          sortOrder: cat.sortOrder,
          isActive: true,
        },
        select: { id: true, slug: true },
      });
      categoryIdBySlug.set(saved.slug, saved.id);
      categoriesUpserted += 1;
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const item of prepared) {
      const categoryId = categoryIdBySlug.get(item.categorySlug);
      const existing = await prisma.vehicleModel.findUnique({
        where: { slug: item.slug },
        select: { id: true, publicSpecs: true },
      });

      const mergedSpecs = existing?.publicSpecs && typeof existing.publicSpecs === 'object' && !Array.isArray(existing.publicSpecs)
        ? { ...existing.publicSpecs, ...item.publicSpecs }
        : item.publicSpecs;

      const model = existing
        ? await prisma.vehicleModel.update({
            where: { id: existing.id },
            data: {
              categoryId,
              name: item.name,
              description: item.description,
              seatCount: item.seatCount,
              publicSpecs: mergedSpecs,
              isActive: true,
              isVerified: true,
            },
            select: { id: true, slug: true },
          })
        : await prisma.vehicleModel.create({
            data: {
              categoryId,
              slug: item.slug,
              name: item.name,
              description: item.description,
              seatCount: item.seatCount,
              publicSpecs: mergedSpecs,
              isActive: true,
              isVerified: true,
            },
            select: { id: true, slug: true },
          });

      if (existing) updatedCount += 1;
      else createdCount += 1;

      await prisma.vehicleRentalOption.upsert({
        where: { modelId_rentalType: { modelId: model.id, rentalType: 'with_driver' } },
        create: { modelId: model.id, rentalType: 'with_driver', isEnabled: true },
        update: { isEnabled: true },
      });

      await prisma.vehicleRentalOption.upsert({
        where: { modelId_rentalType: { modelId: model.id, rentalType: 'self_drive' } },
        create: { modelId: model.id, rentalType: 'self_drive', isEnabled: item.allowSelfDrive },
        update: { isEnabled: item.allowSelfDrive },
      });
    }

    const totalActiveVerified = await prisma.vehicleModel.count({
      where: { isActive: true, isVerified: true },
    });

    console.log(JSON.stringify({
      status: 'ok',
      categoriesUpserted,
      vehiclesProcessed: prepared.length,
      createdCount,
      updatedCount,
      totalActiveVerifiedModelsInDb: totalActiveVerified,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Official fleet import failed:', error?.message || error);
  process.exitCode = 1;
});
