// ============================================================
// CONFIGURACIÓN DE CATEGORÍAS Y ACTIVIDADES
// Edita este archivo para añadir/quitar categorías o actividades
// predeterminadas. Los colores se usan en toda la app y en las
// estadísticas.
//
// Cada actividad puede ser:
//   - un texto simple:  'Beber agua'            (hábito diario)
//   - un objeto:        { name: 'Revisión médica', timesPerWeek: 1 }
//     (hábito con objetivo semanal en vez de diario; la app mostrará
//     su progreso como "X de N esta semana" en vez de un check diario)
// ============================================================

const CATEGORIES = [
  {
    id: 'yo',
    name: 'Yo',
    color: '#8B5CF6', // morado
    icon: '🧘',
    activities: [
      'Meditar',
      'Escribir diario',
      'Tiempo a solas',
      'Practicar gratitud',
      'Terapia / coaching'
    ]
  },
  {
    id: 'salud',
    name: 'Salud',
    color: '#10B981', // verde
    icon: '💪',
    activities: [
      'Beber agua',
      'Tomar vitaminas',
      'Caminar 10.000 pasos',
      'Comer más proteína',
      'Comer menos azúcar/grasa/carbohidratos',
      'Descansar 8 horas',
      { name: 'Revisión médica', timesPerWeek: 1 },
      'Hacer ejercicio'
    ]
  },
  {
    id: 'familia',
    name: 'Familia',
    color: '#EC4899', // rosa
    icon: '❤️',
    activities: [
      'Pasar tiempo con Blanca',
      'Comprar regalos para la familia',
      'Llamar a mi madre',
      'Llamar a mi padre',
      'Llamar a mi hermano',
      { name: 'Llamar a mis abuelos', timesPerWeek: 1 },
      { name: 'Agendar viaje para visitar a la familia', timesPerWeek: 1 }
    ]
  },
  {
    id: 'finanzas',
    name: 'Finanzas',
    color: '#F59E0B', // ámbar
    icon: '💰',
    activities: []
  },
  {
    id: 'trabajo',
    name: 'Trabajo',
    color: '#3B82F6', // azul
    icon: '💼',
    activities: []
  },
  {
    id: 'hobbies',
    name: 'Hobbies',
    color: '#14B8A6', // turquesa
    icon: '🎨',
    activities: [
      'Leer',
      'Escuchar un podcast',
      'Pasar tiempo en la naturaleza'
    ]
  }
];

// Rellena estos dos valores con los de tu proyecto Supabase
// (Configuración del proyecto -> API). Ver README para el paso a paso.
const SUPABASE_URL = 'https://ukyxdpbccabrrqugofwl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QWpw3AO3QRNpIior8Zx15A_xD_gYXhY';
