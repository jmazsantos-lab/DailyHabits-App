// ============================================================
// CONFIGURACIÓN DE CATEGORÍAS Y ACTIVIDADES
// Edita este archivo para añadir/quitar categorías o actividades
// predeterminadas. Los colores se usan en toda la app y en las
// estadísticas.
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
      'Revisión médica',
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
      'Llamar a mis abuelos',
      'Agendar viaje para visitar a la familia'
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
