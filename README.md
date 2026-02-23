# Cien Didis Dijeron

Aplicación web estática para dinámica tipo “100 Mexicanos Dijeron”, con control en tiempo real entre pantallas.

## Pantallas principales

- `admin.html`: panel de conducción del juego (PIN admin).
- `index.html`: pantalla principal para mostrar pregunta, respuestas y marcador.
- `captain.html`: botón buzzer del capitán asignado.
- `questions.html`: CRUD de tipos de pregunta y banco de preguntas/respuestas.
- `instructions.html`: guía para jugadores.

## Inicio rápido

1. Abre `admin.html`.
2. Ingresa PIN admin: `2026`.
3. Abre `index.html` en otra pestaña/dispositivo para mostrar el tablero.
4. Opcional: abre `captain.html?team=A` o `captain.html?team=B` para capitán.
5. Configura tipo de partida, multiplicador y capitanes.
6. Inicia con `Siguiente Pregunta`.

## Reglas de juego implementadas

- Dos equipos compiten por adivinar respuestas populares.
- El buzzer define el equipo con control de ronda.
- `Mostrar/Ocultar` respuestas solo está habilitado cuando existe control de ronda.
- `Agregar Strike` aplica al equipo con control.
- Cierre de ronda:
   - `Termina Ronda`: suma al equipo con control.
   - `Robo de Puntos`: suma al equipo contrario.
- Al cerrar ronda, `Termina Ronda`, `Robo de Puntos` y `Agregar Strike` quedan bloqueados hasta reabrir una nueva ronda/control.
- Al llegar a `500` puntos, se dispara modal de ganador y felicitación.

## Sonidos globales

Se sincronizan entre pantallas conectadas:

- `assets/audio/button.mp3`: buzzer del capitán.
- `assets/audio/correcto.mp3`: respuesta revelada.
- `assets/audio/incorrecto.mp3`: strike.
- `assets/audio/a_jugar.mp3`: siguiente pregunta.
- `assets/audio/triunfo.mp3`: cierre de ronda con puntos.
- `assets/audio/we-are-the-champions.mp3`: ganador de partida.

## Estructura de datos

### Tipos de pregunta

- Tabla: `game_question_types`
- Campos principales: `room_code`, `id`, `name`, `description`

### Preguntas

- Tabla: `game_questions`
- Campos principales: `room_code`, `position`, `question`, `type_id`, `display_order`, `answers (jsonb)`

## Configuración de Base de Datos

Ejecuta el script:

- `supabase/game_questions.sql`

Este script crea/ajusta:

- Tablas y columnas necesarias.
- Índices.
- Políticas RLS para uso del cliente `anon`.
- Backfill de categoría general para compatibilidad.

## Sincronización

El estado usa sincronización híbrida:

- Supabase Realtime.
- Polling de respaldo.
- Reintentos automáticos ante fallos transitorios.
- Persistencia local para continuidad de sesión.

## Despliegue (Vercel)

1. Sube el proyecto a Git.
2. Importa en Vercel.
3. Preset: `Other`.
4. Build command: vacío.
5. Output directory: raíz del proyecto.

## Recomendaciones operativas

- Haz recarga completa (`Ctrl+F5`) tras cambios de assets o audio.
- Verifica en admin el estado “Base de Datos: conectado”.
- Para evento en vivo: una pestaña para admin y otra para pantalla pública.
