# Arquitectura Mejorada de Calibración y Tracking Ocular Espacial
**Contexto para el Agente de Desarrollo:** 
El objetivo de este documento es definir la lógica algorítmica para transicionar nuestro sistema de eye-tracking clínico (basado en MediaPipe FaceLandmarker vía Web Worker) de un mapeo lineal 2D propenso al "drift", a un modelo espacial pseudo-3D robusto. 

Para facilitar el flujo iterativo y la implementación en el front-end (Canvas/React), integraremos un paso inicial de posicionamiento estático antes de la recolección de puntos.

---

## Fase 0: Silueta de Posicionamiento Estática (Pre-Calibración)
Antes de iniciar la recolección matemática de puntos, debemos forzar un entorno geométrico controlado. Para evitar validaciones complejas de bounding boxes en esta etapa, implementaremos una **Silueta Estática Fija**.

**Implementación:**
1. **UI:** Superponer una guía visual (Headbox/Silueta) semitransparente centrada en el canvas del video feed de la webcam.
2. **Instrucción al Paciente:** Pedir al usuario que ajuste físicamente su posición (acercarse/alejarse, mover la pantalla de la laptop) hasta que su rostro encaje visualmente dentro de la silueta.
3. **Trigger Manual/Simple:** Un botón de "Iniciar Calibración" que el paciente o el especialista presiona cuando consideran que están alineados.

**Impacto Algorítmico:**
* **Estabiliza el Eje Z:** Fija una distancia óptima implícita (aprox. 50-60 cm), garantizando un tamaño de Región de Interés (ROI) suficiente para extraer los tensores pupilares sin ruido de sub-píxeles.
* **Minimiza el Paralaje:** Al obligar al paciente a encajar en la silueta, este ajustará intuitivamente el ángulo de la pantalla, reduciendo el offset severo del pitch de la cámara.

---

## Estrategia 1: Estimación Dinámica de Profundidad (Eje Z)
Al no disponer de hardware Lidar/ToF, estimaremos los cambios de profundidad en tiempo real utilizando la **Distancia Interpupilar en Píxeles (IPD)** como proxy matemático.

**Lógica de Ejecución:**
1. **Baseline ($Z_0$):** Durante el primer punto de calibración (Centro - C1), calcular la distancia euclidiana entre el centro pupilar izquierdo (468) y el derecho (473). Este valor será nuestro $IPD_0$.
2. **Inferencia en Tiempo Real:** Por cada frame procesado, calcular el $IPD_{act}$.
3. **Factor de Corrección Sensible:** Actualizar dinámicamente la constante de simulación de distancia ($d_{norm}$) utilizando la relación inversamente proporcional:
   `d_act = d_base * (IPD_0 / IPD_act)`
4. **Efecto:** Si el paciente se acerca al monitor, el IPD en píxeles aumenta, reduciendo el multiplicador $d_{act}$. Esto previene la sobrecompensación ("overshoot") del cursor cuando la cabeza rota de cerca.

---

## Estrategia 2: Compensación del Offset Cámara-Pantalla (Ángulo de Inclinación)
La cámara web (especialmente en laptops) suele mirar ligeramente hacia arriba o hacia abajo. Asumir un plano de proyección perfectamente paralelo a la cara introduce un error de paralaje en el eje Y (Pitch).

**Lógica de Ejecución:**
1. **Captura del Offset Base:** En el punto de calibración central (C1), extraer de MediaPipe el ángulo Pitch de la cabeza ($\beta_0$). No asumiremos que la pantalla está en $0^\circ$.
2. **Enderezado Espacial:** Durante la inferencia, en lugar de proyectar los tensores $L_s$ y $R_s$ directamente sobre el plano de la pantalla, aplicaremos una matriz de rotación inversa basada en $\beta_0$ al vector de la mirada.
3. **Efecto:** Esto "aplana" matemáticamente la perspectiva de la cámara antes del cálculo 2D, reduciendo el drift vertical severo cuando el usuario mira hacia la parte inferior del canvas.

---

## Estrategia 3: Reemplazo del Tensor Lineal por Regresión Polinomial
El mapeo de los desplazamientos del globo ocular a una pantalla plana no es lineal, es tangencial. Usar simples divisores (e.g., $\Delta Screen / \Delta Pupil$) provoca que el cursor sea muy rápido en el centro y no llegue a los bordes de la pantalla.

**Lógica de Ejecución:**
1. Reemplazar la obtención de tensores escalares fijos ($L_s, R_s$) por el entrenamiento de un modelo de **Regresión Polinomial de 2do Grado** ligero en JavaScript/WASM.
2. **Entradas del Modelo (Features):** 
   Vector por frame: `[P_x, P_y, P_x * P_y, Yaw(θ), Pitch(β)]`
   *(Donde P_x y P_y son las coordenadas del vector pupilar relativo E -> P_abs).*
3. **Salidas (Targets):** Las coordenadas `(Screen_X, Screen_Y)`.
4. El término cruzado `P_x * P_y` es crucial porque absorbe matemáticamente la distorsión geométrica introducida por el ángulo de la lente de la cámara y la curvatura del ojo.

---

## Estrategia 4: Expansión a Calibración de 9 Puntos
Para que la regresión polinomial (Estrategia 3) pueda calcular correctamente la curvatura espacial y los coeficientes cruzados, 5 puntos son algebraicamente insuficientes.

**Lógica de Ejecución:**
1. **Matriz de Interfaz:** Expandir el despliegue del flujo de calibración a 9 puntos secuenciales:
   * 1 Centro
   * 4 Esquinas
   * 4 Centros de los bordes (Arriba, Abajo, Izquierda, Derecha).
2. **Recolección Limpia:** Mantener el rechazo microsacádico (descartar el primer 75% del tiempo de fijación).
3. **Dataset Final:** Compilar un array con los promedios estabilizados de los features de los 9 puntos para alimentar y resolver el sistema de ecuaciones de la regresión antes de iniciar el loop de inferencia en tiempo real.
