// ============================================================
// CONFIGURACIÓN · Hábitos v4
// Las actividades ya NO se editan aquí: se crean, editan,
// reordenan y archivan desde la propia app (Ajustes → Actividades).
// ============================================================

// Nombre de la app (también en index.html y manifest.json)
const APP_NAME = 'Órbita';

// Datos de tu proyecto Supabase (Project Settings → API)
const SUPABASE_URL = 'https://ukyxdpbccabrrqugofwl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QWpw3AO3QRNpIior8Zx15A_xD_gYXhY';

// Personas que usan la app
const PEOPLE = {
  jose:   { name: 'José',   ini: 'J', color: '#0A66E8' },
  blanca: { name: 'Blanca', ini: 'B', color: '#D9407A' }
};

// Categorías (orden, nombre, color e icono)
const CATEGORIES = [
  { id: 'yo',       name: 'Yo',       color: '#8B5CF6', icon: '🧘' },
  { id: 'salud',    name: 'Salud',    color: '#10B981', icon: '💪' },
  { id: 'familia',  name: 'Familia',  color: '#EC4899', icon: '❤️' },
  { id: 'finanzas', name: 'Finanzas', color: '#F59E0B', icon: '💰' },
  { id: 'trabajo',  name: 'Trabajo',  color: '#3B82F6', icon: '💼' },
  { id: 'hobbies',  name: 'Hobbies',  color: '#14B8A6', icon: '🎨' }
];
