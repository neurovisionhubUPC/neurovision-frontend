export type ClinicalAudience = 'patient' | 'specialist';

export interface ClinicalTermCopy {
  whatItIs: string;
  whyItMatters: string;
  howToRead: string;
}

export type ClinicalMetricTermId =
  | 'MAD'
  | 'RMSE'
  | 'MAD_RMSE'
  | 'DTW'
  | 'GLOBAL_ACCURACY'
  | 'BCEA'
  | 'SACCADIC_GAIN'
  | 'SACCADIC_LATENCY'
  | 'FOVEAL_FIXATION'
  | 'TRIAL_SUCCESS_OMISSIONS'
  | 'MEDIAN_DURATION'
  | 'FALSE_FIXATIONS'
  | 'QUADRANT_COVERAGE'
  | 'INPUT_ORIGIN'
  | 'SESSION_DURATION_SAMPLES'
  | 'CONFIDENCE_MEAN'
  | 'GAZE_PATH_DISTANCE'
  | 'HEATMAP'
  | 'GAZE_PLOT'
  | 'SEQUENCE_COMPLETENESS'
  | 'ANGULAR_ERROR'
  | 'PARAM_ECCENTRICITY'
  | 'PARAM_MIN_FIXATION'
  | 'PARAM_HEMIFIELD_BIAS'
  | 'PARAM_TARGET_SIZE'
  | 'PARAM_ISI_REST';

export interface ClinicalMetricGlossaryEntry {
  id: ClinicalMetricTermId;
  title: string;
  shortTag?: string;
  patient: ClinicalTermCopy;
  specialist: ClinicalTermCopy;
}

export const CLINICAL_METRIC_GLOSSARY: Record<
  ClinicalMetricTermId,
  ClinicalMetricGlossaryEntry
> = {
  MAD: {
    id: 'MAD',
    title: 'MAD (Desviación Absoluta Media)',
    shortTag: 'Dispersión de mirada',
    patient: {
      whatItIs:
        'Mide qué tanto se separa tu mirada, en promedio, respecto al punto donde intentabas enfocar.',
      whyItMatters:
        'Te ayuda a saber qué tan firme y controlada estuvo tu vista sin saltar de un lado a otro.',
      howToRead:
        'Mientras más bajo sea el número, mejor: indica una mirada más estable sobre el objetivo.',
    },
    specialist: {
      whatItIs:
        'Mean Absolute Deviation: promedio de la distancia euclidiana (en píxeles o fracción normalizada del lienzo) entre cada muestra y el centro objetivo o centroide de fijación.',
      whyItMatters:
        'Evalúa la precisión espacial sostenida y el ruido motor ocular sin amplificar en exceso micro-sacadas aisladas u outliers breves.',
      howToRead:
        'Valores menores reflejan mejor anclaje macular. Compárelo con targetSizePx y el origen de captura (webcam de escritorio vs. contingencia ratón).',
    },
  },
  RMSE: {
    id: 'RMSE',
    title: 'RMSE (Error Cuadrático Medio)',
    shortTag: 'Estabilidad ante saltos',
    patient: {
      whatItIs:
        'Mide qué tan grandes fueron los desvíos más marcados de tu mirada durante el ejercicio.',
      whyItMatters:
        'Detecta si hubo momentos en los que la vista se escapó lejos del objetivo aunque el resto del tiempo estuviera estable.',
      howToRead:
        'Mientras más bajo sea, mejor: quiere decir que casi no hubo saltos grandes fuera de la diana.',
    },
    specialist: {
      whatItIs:
        'Root Mean Square Error: raíz del promedio de desviaciones al cuadrado respecto al punto de referencia, penalizando con mayor peso las excursiones grandes.',
      whyItMatters:
        'Permite detectar inestabilidad intermitente, sacadas intrusivas, fatiga oculomotora o pérdida temporal de seguimiento en webcam.',
      howToRead:
        'Una brecha amplia entre RMSE y MAD señala picos de desvío o jitter en la estimación de mirada más que un sesgo constante.',
    },
  },
  MAD_RMSE: {
    id: 'MAD_RMSE',
    title: 'Error MAD / RMSE',
    shortTag: 'Precisión espacial',
    patient: {
      whatItIs:
        'Resume qué tan cerca se mantuvo tu vista del centro de cada estímulo: primero el promedio (MAD) y después los desvíos más grandes (RMSE).',
      whyItMatters:
        'Sirve para comprobar si logras sostener la mirada con calma o si tu vista tiende a desviarse por momentos.',
      howToRead:
        'Mientras más bajos sean ambos valores en píxeles (px) y el porcentaje de desvío medio, más precisa fue tu fijación.',
    },
    specialist: {
      whatItIs:
        'Par de dispersión espacial respecto al objetivo: MAD (error absoluto promedio en px y porcentaje normalizado) junto a RMSE (sensibilidad cuadrática a picos de desvío).',
      whyItMatters:
        'Diferencia entre imprecisión sistemática constante y episodios breves de deriva oculomotora o ruido de inferencia facial.',
      howToRead:
        'Valores bajos indican convergencia estable dentro del radio de aceptación; si RMSE supera ampliamente a MAD, revise confianza media y pérdida de postura.',
    },
  },
  DTW: {
    id: 'DTW',
    title: 'DTW Score (Similitud de Trayectoria)',
    shortTag: 'Fidelidad del recorrido',
    patient: {
      whatItIs:
        'Compara el camino real que hicieron tus ojos (o el cursor) frente al recorrido directo ideal entre un punto y otro.',
      whyItMatters:
        'Muestra si lograste buscar los objetivos con movimientos ordenados, aunque los hicieras un poco más lento o rápido.',
      howToRead:
        'Mientras más cercano a 0, mejor es la coincidencia con la trayectoria esperada; números más altos indican recorridos con más rodeos o exploración extra.',
    },
    specialist: {
      whatItIs:
        'Dynamic Time Warping: métrica elástica que alinea temporalmente la secuencia observada contra la trayectoria ideal estímulo-a-estímulo para cuantificar fidelidad morfológica.',
      whyItMatters:
        'A diferencia de la distancia punto a punto, tolera variaciones en velocidad de respuesta (latencia) mientras penaliza búsqueda desorganizada u omisión de hemicampo.',
      howToRead:
        'Valores menores implican trayectorias sacádicas más limpias y directas; interpretarlo siempre según el tipo de ejercicio y origen de entrada.',
    },
  },
  GLOBAL_ACCURACY: {
    id: 'GLOBAL_ACCURACY',
    title: 'Precisión Global',
    shortTag: 'Alineación al objetivo',
    patient: {
      whatItIs:
        'Es el porcentaje general de qué tan cerca estuvieron tus fijaciones del lugar exacto donde apareció cada objetivo.',
      whyItMatters:
        'Te da una idea rápida y fácil de qué tan bien coordinaste tu vista con los puntos de la pantalla durante la sesión.',
      howToRead:
        'Mientras más alto (cerca de 100%), mejor apuntaste hacia las dianas activas.',
    },
    specialist: {
      whatItIs:
        'Índice compuesto derivado de la proximidad media normalizada de la mirada respecto a los estímulos presentados en las fases activas del módulo.',
      whyItMatters:
        'Resume el rendimiento espacial global de la tanda para comparar adherencia y mejora longitudinal dentro de una misma configuración prescrita.',
      howToRead:
        'Úselo como indicador descriptivo de sesión; valide siempre que totalSamples > 0 y verifique el origen (Mirada Webcam vs. Contingencia Ratón).',
    },
  },
  BCEA: {
    id: 'BCEA',
    title: 'BCEA 68% (Área de Dispersión de Fijación)',
    shortTag: 'Estabilidad foveal',
    patient: {
      whatItIs:
        'Calcula el tamaño aproximado de la "zona" o elipse donde cayó el 68% de tu mirada cuando intentabas quedarte quieto en un punto.',
      whyItMatters:
        'Ayuda al especialista a ver si tu vista se concentra en un área pequeña o se dispersa por cansancio o búsqueda compensatoria.',
      howToRead:
        'Mientras más pequeño sea el valor en deg², más concentrada y estable estuvo tu fijación. En webcam de escritorio es una estimación orientativa.',
    },
    specialist: {
      whatItIs:
        'Bivariate Contour Ellipse Area (68%, χ² ≈ 2.2977): área en grados² que engloba el 68% central de las muestras asumiendo normalidad bivariada.',
      whyItMatters:
        'Estima estabilidad de fijación central/macular e identifica nistagmo sutil, fijación excéntrica compensatoria o dispersión elevada.',
      howToRead:
        'Menor área = mayor estabilidad. En captura con cámara web de escritorio o GazePlot normalizado [0..1], considérelo un índice exploratorio de tendencia y no una perimetría clínica calibrada.',
    },
  },
  SACCADIC_GAIN: {
    id: 'SACCADIC_GAIN',
    title: 'Ganancia Sacádica',
    shortTag: 'Exactitud del salto visual',
    patient: {
      whatItIs:
        'Mide si el salto rápido de tus ojos llegó exactamente al nuevo punto, se quedó corto o se pasó de largo.',
      whyItMatters:
        'En rehabilitación ayuda a entrenar saltos de mirada más exactos hacia el lado que cuesta más trabajo ver.',
      howToRead:
        'Un valor cercano a 1.0 es lo ideal (1.0 = salto exacto; menor a 1.0 = se quedó corto; mayor a 1.0 = se pasó un poco).',
    },
    specialist: {
      whatItIs:
        'Cociente adimensional entre la amplitud sacádica primaria ejecutada y la excentricidad angular o desplazamiento real requerido hacia el estímulo.',
      whyItMatters:
        'Cuantifica hipometría (< 1.0, típica en estrategias cautelosas hacia hemicampo anópsico) o hipermetría (> 1.0, sobrecorrección).',
      howToRead:
        'Rango fisiológico objetivo ≈ 0.85–1.05. Valores muy bajos persistentes sugieren reducir excentricidad o entrenar con Compensatory Saccade.',
    },
  },
  SACCADIC_LATENCY: {
    id: 'SACCADIC_LATENCY',
    title: 'Latencia Sacádica',
    shortTag: 'Tiempo de reacción ocular',
    patient: {
      whatItIs:
        'Es el tiempo, en milisegundos (ms), que tardan tus ojos en empezar a moverse hacia un punto nuevo desde que aparece.',
      whyItMatters:
        'Refleja qué tan rápido detectas estímulos nuevos y reaccionas hacia tu campo visual.',
      howToRead:
        'Mientras más bajo sea el tiempo en ms (por ejemplo entre 200 y 450 ms), más ágil fue tu respuesta visual.',
    },
    specialist: {
      whatItIs:
        'Intervalo temporal (ms) entre el onset del estímulo objetivo y el inicio/desplazamiento efectivo de la respuesta sacádica hacia el objetivo.',
      whyItMatters:
        'Indicador clave de procesamiento atencional y programación oculomotora, sensible a carga cognitiva, distractores y déficit de hemicampo.',
      howToRead:
        'Disminuciones progresivas respecto al basal del paciente evidencian compensación sacádica; condicionado en webcam por la frecuencia real de inferencia (>= 4 Hz).',
    },
  },
  FOVEAL_FIXATION: {
    id: 'FOVEAL_FIXATION',
    title: 'Fijación Foveal y Simetría de Hemicampos',
    shortTag: 'Control e Izq/Der',
    patient: {
      whatItIs:
        'Muestra qué porcentaje del tiempo lograste mantener la vista dentro del centro de los objetivos y cómo se repartió tu mirada entre el lado izquierdo y el derecho.',
      whyItMatters:
        'Permite ver si mantienes la atención fija cuando hace falta y si estás explorando bien hacia el lado más débil.',
      howToRead:
        'Un porcentaje alto indica buen control de fijación; el balance Izq / Der muestra hacia qué lado miraste con más frecuencia.',
    },
    specialist: {
      whatItIs:
        'Proporción de muestras válidas mantenidas dentro del radio de aceptación objetivo junto con la distribución bilateral de exploración entre hemicampo izquierdo (x < 0.5) y derecho (x >= 0.5).',
      whyItMatters:
        'Evalúa persistencia foveal y asimetría de rastreo compensatorio respecto al affectedHemifield consignado en el contexto clínico.',
      howToRead:
        'Fijación elevada + mejora en cobertura del hemicampo deficitario señalan compensación funcional sin abandono lateral.',
    },
  },
  TRIAL_SUCCESS_OMISSIONS: {
    id: 'TRIAL_SUCCESS_OMISSIONS',
    title: 'Ensayos Exitosos vs. Omisiones / Timeout',
    shortTag: 'Cumplimiento por estímulo',
    patient: {
      whatItIs:
        'Cuenta cuántos objetivos lograste completar sosteniendo la vista a tiempo y en cuántos se agotó el tiempo límite antes de terminar.',
      whyItMatters:
        'Muestra si la velocidad y dificultad del ejercicio están bien ajustadas para ti o si el tiempo por objetivo fue muy corto.',
      howToRead:
        'Más ensayos exitosos y menos omisiones significan mejor desempeño. Muchas omisiones pueden deberse a fatiga, velocidad alta o baja luz en la cámara.',
    },
    specialist: {
      whatItIs:
        'Conteo discreto de ensayos cerrados por adquisición válida (SUCCESS/COMPLETED) frente a vencimiento de ventana máxima (TIMEOUT/TIMED_OUT), excluyendo los interrumpidos de métricas de latencia elegible.',
      whyItMatters:
        'Mide eficacia perceptual real bajo la prescripción frozenParameters y detecta ventanas demasiado estrictas frente a la tasa de captura.',
      howToRead:
        'Alta tasa de timeout exige revisar headroom (maximumStimulusDurationMs - minimumFixationMs), excentricidad o soporte >= 4 Hz de la cámara.',
    },
  },
  MEDIAN_DURATION: {
    id: 'MEDIAN_DURATION',
    title: 'Mediana de Localización / Búsqueda',
    shortTag: 'Tiempo típico por acierto',
    patient: {
      whatItIs:
        'Es el tiempo típico (en milisegundos) que tardaste en encontrar y confirmar cada objetivo en tus intentos logrados.',
      whyItMatters:
        'Al usar el valor central (mediana), una pausa puntual no distorsiona tu avance real.',
      howToRead:
        'Mientras más bajo (más cercano al tiempo mínimo de fijación configurado), más rápido encontraste los objetivos. Si aparece N/A, es porque no hubo intentos completados.',
    },
    specialist: {
      whatItIs:
        'Mediana estadística de duración desde aparición del estímulo hasta confirmación del dwell mínimo en ensayos elegibles (solo ensayos exitosos completos).',
      whyItMatters:
        'Robusta ante valores atípicos extremos; permite separar la componente de búsqueda/latencia respecto al minimumFixationMs obligatorio.',
      howToRead:
        'N/D o N/A indica 0 ensayos elegibles completados (no sustituye a 0 ms). Compare (mediana - minimumFixationMs) entre sesiones.',
    },
  },
  FALSE_FIXATIONS: {
    id: 'FALSE_FIXATIONS',
    title: 'Falsas Fijaciones',
    shortTag: 'Desvíos a distractores',
    patient: {
      whatItIs:
        'Cuenta cuántas veces tu mirada se quedó detenida sobre un elemento distractor en lugar del objetivo correcto.',
      whyItMatters:
        'Mide qué tan bien logras ignorar elementos que confunden y concentrarte solo en las dianas reales.',
      howToRead:
        'Mientras más cercano a 0, mejor discriminación visual: menos veces caíste en distractores.',
    },
    specialist: {
      whatItIs:
        'Número de fijaciones sostenidas sobre estímulos distractores durante Búsqueda Visual (TARGET_SEARCH_WITH_DISTRACTORS) que superaron el umbral temporal de falsa captura.',
      whyItMatters:
        'Cuantifica impulsividad sacádica, vulnerabilidad al crowding o dificultad para discriminar forma/color frente a distractorCount.',
      howToRead:
        'Valor 0 indica control inhibitorio limpio. Aumento sostenido sugiere bajar distractores o ampliar targetSizePx antes de subir dificultad.',
    },
  },
  QUADRANT_COVERAGE: {
    id: 'QUADRANT_COVERAGE',
    title: 'Cobertura Espacial / de Cuadrantes',
    shortTag: 'Amplitud de rastreo',
    patient: {
      whatItIs:
        'Indica qué porcentaje de las áreas o zonas de la pantalla lograste recorrer con tu mirada durante el ejercicio.',
      whyItMatters:
        'En terapia visual ayuda a asegurarse de no dejar zonas olvidadas, especialmente del lado afectado.',
      howToRead:
        'Mientras más cercano a 100%, más completa fue tu exploración por toda la pantalla.',
    },
    specialist: {
      whatItIs:
        'Proporción de cuadrantes clínicos visitados (Systematic Exploration) o occupiedCellRatio de celdas cubiertas en la grilla normalizada [0..1] (Analytics 8085).',
      whyItMatters:
        'Verifica cobertura sistemática del campo visual y detecta persistencia de negligencia/omisión sectorial pese a buena precisión puntual.',
      howToRead:
        'Evalúese junto al Heatmap y cuadrantes Q1–Q4: una cobertura baja concentrada en un solo hemicampo confirma falta de barrido compensatorio.',
    },
  },
  INPUT_ORIGIN: {
    id: 'INPUT_ORIGIN',
    title: 'Origen de Datos (Webcam vs. Ratón)',
    shortTag: 'Procedencia de captura',
    patient: {
      whatItIs:
        'Indica si esta sesión se midió con seguimiento real de tus ojos por cámara web (Mirada Webcam), con ratón de respaldo (Contingencia Ratón), de forma mixta o sin muestras oculares.',
      whyItMatters:
        'Es importante saber con qué dispositivo entrenaste para que tú y tu especialista interpreten bien los resultados.',
      howToRead:
        'Mirada Webcam / PRODUCER_REPORTED corresponde a cámara ocular; Contingencia Ratón / SYNTHETIC indica uso de puntero manual cuando la cámara no pudo usarse.',
    },
    specialist: {
      whatItIs:
        'Etiqueta de trazabilidad del canal de entrada: PRODUCER_REPORTED (webcam ocular real), SYNTHETIC (contingencia ratón/puntero), MIXED o NONE (0 muestras oculares válidas).',
      whyItMatters:
        'Evita mezclar métricas visomotoras manuales (SYNTHETIC) con biomarcadores oculomotores reales de seguimiento ocular (PRODUCER_REPORTED) al evaluar evolución clínica.',
      howToRead:
        'Solo compare longitudinalmente curvas oculomotoras dentro del mismo origen; sesiones SYNTHETIC sirven para entrenamiento cognitivo-espacial, no para agudeza ocular.',
    },
  },
  SESSION_DURATION_SAMPLES: {
    id: 'SESSION_DURATION_SAMPLES',
    title: 'Duración Activa y Muestras Contabilizadas',
    shortTag: 'Volumen de captura',
    patient: {
      whatItIs:
        'Muestra cuánto tiempo efectivo duró el ejercicio y cuántas mediciones válidas alcanzó a tomar el sistema durante las rondas activas.',
      whyItMatters:
        'Asegura que el ejercicio tuvo suficientes datos para calcular tus métricas de forma justa.',
      howToRead:
        'A mayor tiempo activo con buen número de muestras válidas, más representativo es el resumen de la sesión.',
    },
    specialist: {
      whatItIs:
        'Tiempo acumulado en fase activa (excluyendo descansos interestímulo) y conteo de muestras únicas contabilizadas (muestras oculares válidas o eventos de ratón/gameplay).',
      whyItMatters:
        'Verifica densidad mínima de muestreo (minimumValidSampleCount del plan) y permite detectar cierres prematuros o interrupciones de cámara antes de interpretar KPIs.',
      howToRead:
        'Sesiones con 0 o muy pocas muestras oculares invalidan estadísticas de dispersión/DTW independientemente del porcentaje mostrado en pantalla.',
    },
  },
  CONFIDENCE_MEAN: {
    id: 'CONFIDENCE_MEAN',
    title: 'Confianza Media y Calidad de Seguimiento',
    shortTag: 'Fiabilidad del sensor',
    patient: {
      whatItIs:
        'Indica qué tan claramente pudo ver la cámara tus ojos e iris durante la sesión.',
      whyItMatters:
        'Cuando hay buena luz y tu rostro queda centrado, la cámara mide con mucha mayor seguridad.',
      howToRead:
        'Por encima de 70–80% indica captura confiable; valores bajos suelen deberse a poca luz, reflejos en gafas o mover mucho la cabeza.',
    },
    specialist: {
      whatItIs:
        'Promedio de scores de confianza por muestra emitidos por el detector facial/iris (umbral mínimo de validez por frame >= 0.35) junto con su distribución por histograma.',
      whyItMatters:
        'Actúa como control de calidad previo a cualquier inferencia clínica: baja confianza indica oclusión, iluminación insuficiente o baja frecuencia efectiva (< 4 Hz).',
      howToRead:
        'Valores >= 0.70 respaldan validez biométrica aceptable; colas altas en bins bajos del histograma aconsejan revisar ambientación antes de ajustar parámetros clínicos.',
    },
  },
  GAZE_PATH_DISTANCE: {
    id: 'GAZE_PATH_DISTANCE',
    title: 'Distancia Gaze Path y Velocidad Media',
    shortTag: 'Economía de búsqueda',
    patient: {
      whatItIs:
        'Mide la longitud total del recorrido que hizo tu mirada en la pantalla y qué tan rápido se movió en promedio.',
      whyItMatters:
        'Ayuda a notar si encontraste los objetivos con desplazamientos suaves o si tuviste que hacer muchos barridos largos.',
      howToRead:
        'En unidades normalizadas (u): valores moderados acordes a los estímulos muestran búsqueda eficiente sin exceso de recorrido innecesario.',
    },
    specialist: {
      whatItIs:
        'Suma acumulada de desplazamientos euclidianos entre puntos sucesivos en coordenadas normalizadas [0..1] (`u` de ancho/alto del lienzo) y su tasa media por segundo (`u/s`).',
      whyItMatters:
        'Cuantifica esfuerzo exploratorio y economía del rastreo (scanpath length): distingue estrategias organizadas de exploración errática o hiperactividad sacádica.',
      howToRead:
        'Depende del número de ensayos y duración: compárelo normalizado por ensayo exitoso y filtre cortes de segmento (segmentBreakBefore) y ruido de baja frecuencia.',
    },
  },
  HEATMAP: {
    id: 'HEATMAP',
    title: 'Mapa de Calor (Heatmap) Normalizado',
    shortTag: 'Zonas más observadas',
    patient: {
      whatItIs:
        'Colorea la pantalla según qué zonas miraste más veces: los tonos más intensos muestran dónde se concentró tu atención.',
      whyItMatters:
        'Permite ver de un vistazo si miraste todo el campo visual o si dejaste algún lado con menos exploración.',
      howToRead:
        'Zonas claras = pocas o ninguna muestra; zonas intensas = mayor cantidad de muestras registradas en esa región.',
    },
    specialist: {
      whatItIs:
        'Grilla espacial sobre coordenadas normalizadas [0..1] (16:9) que agrega conteos relativos (cellWeight) de muestras de mirada (opcionalmente filtradas por confianza).',
      whyItMatters:
        'Visualiza sesgos hemisféricos, fijación central predominante o déficits espaciales de barrido entre hemicampos y cuadrantes.',
      howToRead:
        'Representa densidad de muestras observadas relativas al pico de la sesión; no equivale exactamente a duración absoluta de fijación ni constituye diagnóstico aislado.',
    },
  },
  GAZE_PLOT: {
    id: 'GAZE_PLOT',
    title: 'Gaze Plot Vectorial',
    shortTag: 'Secuencia de mirada',
    patient: {
      whatItIs:
        'Dibuja con puntos y líneas el orden aproximado en que fue saltando tu mirada por la pantalla.',
      whyItMatters:
        'Ayuda a entender el camino que seguiste para localizar los objetivos durante el ejercicio.',
      howToRead:
        'Los círculos verdes señalan puntos medidos con buena calidad; los tonos cálidos indican menor certeza de la cámara en ese instante.',
    },
    specialist: {
      whatItIs:
        'Representación secuencial paginada [0..1] de muestras/fijaciones conectadas por vectores sacádicos cuando no existe ruptura de segmento (`!segmentBreakBefore`).',
      whyItMatters:
        'Permite inspeccionar orden de exploración (izquierda-derecha, barrido sistemático), saltos compensatorios y pérdida de tracking entre bloques.',
      howToRead:
        'Verifique si existe paginación (`hasNext`): las vistas previas acotadas solo muestran la primera página de puntos; use Auditoría Completa para recorrer la secuencia total.',
    },
  },
  SEQUENCE_COMPLETENESS: {
    id: 'SEQUENCE_COMPLETENESS',
    title: 'Completitud de Secuencia y Llegadas Tardías',
    shortTag: 'Integridad de telemetría',
    patient: {
      whatItIs:
        'Comprueba que los datos enviados al sistema hayan llegado completos y en el orden correcto durante la terapia.',
      whyItMatters:
        'Garantiza que ninguna parte de tu esfuerzo se perdió por cortes temporales de red.',
      howToRead:
        'Rangos faltantes en 0 significa que toda tu sesión quedó registrada de principio a fin sin huecos.',
    },
    specialist: {
      whatItIs:
        'Auditoría de integridad del stream en Analytics 8085: rango `[minimumSequence..maximumSequence]`, `missingSequenceRangeCount` (huecos no ingeridos) y `lateArrivalCount`.',
      whyItMatters:
        'Valida si las métricas del stream (Heatmap, GazePlot, Summary) representan la sesión completa o presentan pérdida de lotes/desconexión.',
      howToRead:
        'Faltantes = 0 confirma integridad total. Llegadas tardías altas indican reintentos de cola tras latencia de red sin pérdida cuando faltantes = 0.',
    },
  },
  ANGULAR_ERROR: {
    id: 'ANGULAR_ERROR',
    title: 'Error Angular Medio (°)',
    shortTag: 'Desviación visual',
    patient: {
      whatItIs:
        'Expresa en grados de ángulo visual qué tan cerca quedó tu mirada del centro exacto del estímulo.',
      whyItMatters:
        'Es una forma médica estándar de medir puntería visual sin depender del tamaño físico del monitor.',
      howToRead:
        'Mientras más bajo en grados (°), más certera estuvo la mirada (valores cercanos o menores a 1.5° indican muy buena precisión).',
    },
    specialist: {
      whatItIs:
        'Desviación angular estimada (°) entre el eje de mirada calibrado y el objetivo retinotópico considerando distancia de visualización nominal.',
      whyItMatters:
        'Estandariza el error espacial independientemente de la resolución de pantalla; umbral de referencia favorable < 1.5° en condiciones controladas.',
      howToRead:
        'Errores >= 2.0° con pérdida postural suelen requerir recalibración o corrección de distancia/iluminación antes de subir exigencia clínica.',
    },
  },
  PARAM_ECCENTRICITY: {
    id: 'PARAM_ECCENTRICITY',
    title: 'Excentricidad Angular (5°–30°)',
    shortTag: 'Distancia periférica',
    patient: {
      whatItIs:
        'Controla qué tan lejos del centro de la pantalla aparecen los puntos hacia los lados.',
      whyItMatters:
        'Permite empezar cerca de tu zona cómoda e ir ampliando poco a poco el alcance visual.',
      howToRead:
        'Ángulos pequeños (5°–10°) aparecen cerca del centro; ángulos mayores (20°–30°) exigen explorar más hacia la periferia.',
    },
    specialist: {
      whatItIs:
        'Separación angular retinotópica respecto al punto de fijación central (rango Schema v2: 5° a 30° enteros) hacia el hemicampo configurado.',
      whyItMatters:
        'Dosifica la amplitud de las sacadas compensatorias y el estímulo en zona límite de escotoma o hemianopsia homónima.',
      howToRead:
        'Excentricidades altas (> 20°) demandan mayor amplitud sacádica y margen temporal adecuado para evitar omisiones por latencia.',
    },
  },
  PARAM_MIN_FIXATION: {
    id: 'PARAM_MIN_FIXATION',
    title: 'Fijación Mínima (Dwell Time)',
    shortTag: 'Tiempo para confirmar',
    patient: {
      whatItIs:
        'Es el tiempo seguido que debes mantener la vista sobre un objetivo para que cuente como logrado.',
      whyItMatters:
        'Evita aciertos por accidente al pasar rápido la mirada y entrena la estabilidad visual.',
      howToRead:
        'En milisegundos (ms): valores más bajos hacen el ejercicio más ágil; valores altos exigen sostener la vista más firme.',
    },
    specialist: {
      whatItIs:
        'Duración continua de permanencia válida requerida sobre una entidad (`minimumFixationMs`) para validar adquisición sin falsos positivos ni capturas congeladas.',
      whyItMatters:
        'Debe guardar compatibilidad estricta con la ventana máxima y la frecuencia real de inferencia (>= 4 Hz): demasiada proximidad al máximo reduce el margen de reacción.',
      howToRead:
        'Asegure al menos >= 250 ms de margen (headroom) entre ventana disponible y dwell total requerido, especialmente con múltiples objetivos simultáneos.',
    },
  },
  PARAM_HEMIFIELD_BIAS: {
    id: 'PARAM_HEMIFIELD_BIAS',
    title: 'Sesgo hacia Hemicampo Deficitario (bias)',
    shortTag: 'Distribución lateral',
    patient: {
      whatItIs:
        'Define qué proporción de objetivos aparece del lado visual que necesita más entrenamiento.',
      whyItMatters:
        'Concentra el ejercicio en fortalecer el campo más débil sin descuidar por completo el resto de la pantalla.',
      howToRead:
        '0.50 reparte por igual izquierda y derecha; valores entre 0.70 y 1.00 enfocan la mayoría de los objetivos en el lado deficitario.',
    },
    specialist: {
      whatItIs:
        'Probabilidad (`0.50..1.00`) de ubicar estímulos diana de Búsqueda Visual en el `affectedHemifield` consignado para el paciente.',
      whyItMatters:
        'Regula la carga terapéutica unilateral progresiva frente a negligencia espacial o restricción homónima sin volver totalmente predecible la aparición.',
      howToRead:
        '0.75 suele equilibrar refuerzo específico e incertidumbre; 1.00 fuerza entrenamiento exclusivo sobre el hemicampo comprometido.',
    },
  },
  PARAM_TARGET_SIZE: {
    id: 'PARAM_TARGET_SIZE',
    title: 'Tamaño de Diana (targetSizePx)',
    shortTag: 'Área de acierto',
    patient: {
      whatItIs:
        'Ajusta qué tan grande o pequeño se muestra cada círculo objetivo en la pantalla.',
      whyItMatters:
        'Objetivos más grandes facilitan el inicio de la terapia o compensan vibración leve de cámara; más pequeños exigen mayor puntería.',
      howToRead:
        'Medido en píxeles (30 a 150 px): números mayores = objetivos más grandes y fáciles de fijar.',
    },
    specialist: {
      whatItIs:
        'Diámetro visual del estímulo (`30..150 px`) que determina proporcionalmente su radio de aceptación espacial durante el dwell continuo.',
      whyItMatters:
        'Compensa tolerancia angular de webcams domésticas y fatiga foveal sin comprometer la especificidad de búsqueda cuando se calibra acorde a dificultad.',
      howToRead:
        'Con webcams a baja tasa (4–8 Hz) o error angular > 1.5°, prefiera dianas >= 60 px para evitar falsos rechazos de dwell.',
    },
  },
  PARAM_ISI_REST: {
    id: 'PARAM_ISI_REST',
    title: 'Intervalo Interestímulo / Descanso (ISI / Rest)',
    shortTag: 'Pausa entre intentos',
    patient: {
      whatItIs:
        'Es la pausa en milisegundos entre un objetivo y el siguiente para que tus ojos descansen un instante y vuelvan al centro.',
      whyItMatters:
        'Ayuda a evitar cansancio visual y a separar claramente cada intento del ejercicio.',
      howToRead:
        'Valores altos dan más respiro entre estímulos; valores bajos hacen el ritmo más continuo.',
    },
    specialist: {
      whatItIs:
        'Ventana temporal de reposo entre ensayos (`interStimulusIntervalMs` o `restBetweenRepetitionsMs`, rango `500..3000 ms`) durante la cual se suspende el registro activo de dwell.',
      whyItMatters:
        'Previene arrastre atencional, fatiga de parpadeo y contaminación de muestras entre repeticiones consecutivas.',
      howToRead:
        'Incrementarlo reduce carga y mejora estabilidad de la línea base en pacientes con fatigabilidad sacádica temprana.',
    },
  },
};

export function getClinicalMetricCopy(
  termId: ClinicalMetricTermId,
  audience: ClinicalAudience
): ClinicalTermCopy {
  const entry = CLINICAL_METRIC_GLOSSARY[termId];
  return audience === 'patient' ? entry.patient : entry.specialist;
}
