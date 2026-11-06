import React, { useState, useMemo } from 'react';
import { 
  Search, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  CalendarDays, 
  BadgeCheck, 
  Eye, 
  Clock, 
  ChevronLeft, 
  ChevronRight, 
  ShieldCheck, 
  Award,
  Download
} from 'lucide-react';
import type { SessionRecord } from '../../../../core/domain/Patient';

interface SessionHistoryTabProps {
  sessions: SessionRecord[];
  onOpenAnalytics: (session: SessionRecord) => void;
  onDownloadSessionPDF: (session: SessionRecord) => void;
  onDownloadConsolidatedPDF: () => void;
  onIssueCertifiedReport: () => void;
}

export const SessionHistoryTab: React.FC<SessionHistoryTabProps> = ({
  sessions,
  onOpenAnalytics,
  onDownloadSessionPDF,
  onDownloadConsolidatedPDF,
  onIssueCertifiedReport,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [exerciseFilter, setExerciseFilter] = useState('all');
  const [validityFilter, setValidityFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  // Filtrado de sesiones
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchModule = s.moduleName.toLowerCase().includes(query);
        const matchDate = s.dateText.toLowerCase().includes(query);
        if (!matchModule && !matchDate) return false;
      }

      if (exerciseFilter !== 'all') {
        if (!s.moduleName.toLowerCase().includes(exerciseFilter.toLowerCase())) {
          return false;
        }
      }

      if (validityFilter === 'valid') {
        if (!s.isValid) return false;
      } else if (validityFilter === 'incidents') {
        if (s.isValid) return false;
      }

      return true;
    });
  }, [sessions, searchTerm, exerciseFilter, validityFilter]);

  const totalPages = Math.ceil(filteredSessions.length / pageSize) || 1;
  const paginatedSessions = filteredSessions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <section className="flex flex-col gap-6">
      {/* Sub-Header & Controls Filter Bar */}
      <div className="bg-white rounded-xl border border-[#071524]/10 p-4 md:p-5 flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center shadow-xs">
        {/* Search and Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 flex-1">
          {/* Search input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#74777C]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por módulo o fecha..."
              className="w-full pl-9 pr-3 py-2 text-xs md:text-sm bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] placeholder:text-[#74777C] focus:outline-none focus:ring-2 focus:ring-[#006A62]"
            />
          </div>

          {/* Exercise Filter */}
          <div className="relative">
            <select
              value={exerciseFilter}
              onChange={(e) => setExerciseFilter(e.target.value)}
              aria-label="Filtrar por ejercicio"
              className="w-full py-2 pl-3 pr-8 text-xs md:text-sm bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="all">Todos los ejercicios</option>
              <option value="Búsqueda Visual">Búsqueda Visual Dinámica</option>
              <option value="Fijación Foveal">Fijación Foveal y Estabilidad</option>
              <option value="Exploración Sacádica">Exploración Sacádica</option>
            </select>
          </div>

          {/* Validity Filter */}
          <div className="flex gap-2">
            <select
              value={validityFilter}
              onChange={(e) => setValidityFilter(e.target.value)}
              aria-label="Validez de telemetría"
              className="w-full py-2 pl-2 pr-6 text-xs bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="all">Validez: Todas las sesiones</option>
              <option value="valid">Solo Válidas (Telemetría Óptima)</option>
              <option value="incidents">Solo con Incidencias / Fatiga</option>
            </select>
          </div>
        </div>

        {/* Batch Action */}
        <div className="shrink-0 flex items-center gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#071524]/10">
          <button
            onClick={onDownloadConsolidatedPDF}
            className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#071524] text-white hover:bg-[#1C2A39] transition-colors shadow-xs cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#84F5E8]" />
            <span>Descargar Reporte Consolidado (PDF Clínico)</span>
          </button>
        </div>
      </div>

      {/* Summary KPIs Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#071524] flex items-center justify-center shrink-0">
            <CalendarDays className="w-6 h-6 text-[#006A62]" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Total Sesiones Registradas</p>
            <p className="text-xl font-bold text-[#071524]">{sessions.length} sesiones</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#006A62] flex items-center justify-center shrink-0">
            <BadgeCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Tasa de Cumplimiento Promedio</p>
            <p className="text-xl font-bold text-[#071524]">94.8%</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#071524] flex items-center justify-center shrink-0">
            <Eye className="w-6 h-6 text-[#006A62]" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Validadas por Algoritmo de Mirada</p>
            <p className="text-xl font-bold text-[#071524]">
              {sessions.filter((s) => s.isValid).length} / {sessions.length}{' '}
              <span className="text-xs font-normal text-[#44474C]">
                ({Math.round((sessions.filter((s) => s.isValid).length / Math.max(1, sessions.length)) * 100)}%)
              </span>
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#006A62] flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Última Sesión</p>
            <p className="text-xs sm:text-sm font-bold text-[#071524]">
              Hoy, 08:30 AM <span className="text-xs text-[#006A62] font-semibold">(Completada)</span>
            </p>
          </div>
        </div>
      </div>

      {/* Structured Session History Table */}
      <div className="bg-white rounded-xl border border-[#071524]/10 shadow-xs overflow-hidden">
        <div className="p-4 md:px-6 md:py-4 bg-[#E6F6FF]/70 border-b border-[#071524]/10 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h2 className="text-sm md:text-base font-bold text-[#071524]">
              Registro Detallado de Telemetría Clínica
            </h2>
            <span className="px-2 py-0.5 rounded-md text-xs bg-[#DBF1FE] text-[#071524] font-semibold">
              {filteredSessions.length} entradas
            </span>
          </div>
          <span className="text-xs text-[#44474C] font-medium hidden sm:inline-block">
            Algoritmo de Rastreo Ocular v4.2.1 • HL7 FHIR Compliant
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr className="border-b border-[#071524]/10 bg-[#E6F6FF]/40 text-xs font-bold text-[#44474C] uppercase tracking-wider">
                <th className="py-3 px-4 md:px-6" scope="col">Fecha & Hora</th>
                <th className="py-3 px-4" scope="col">Módulo de Ejercicio</th>
                <th className="py-3 px-4" scope="col">Duración</th>
                <th className="py-3 px-4 min-w-[140px]" scope="col">Cumplimiento</th>
                <th className="py-3 px-4" scope="col">Fijación Foveal</th>
                <th className="py-3 px-4" scope="col">Validación Técnica</th>
                <th className="py-3 px-4 md:px-6 text-right" scope="col">Acciones Clínicas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#071524]/10 font-normal text-xs md:text-sm">
              {paginatedSessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#74777C]">
                    No se encontraron sesiones registradas con los criterios seleccionados.
                  </td>
                </tr>
              ) : (
                paginatedSessions.map((session) => {
                  const isInterrupted = session.interrupted || session.validationStatus === 'INTERRUPTED_FATIGUE';

                  return (
                    <tr
                      key={session.id}
                      className={`transition-colors ${
                        isInterrupted
                          ? 'bg-[#FFDCC4]/20 hover:bg-[#FFDCC4]/30'
                          : 'hover:bg-[#E6F6FF]/40'
                      }`}
                    >
                      {/* Fecha & Hora */}
                      <td className="py-4 px-4 md:px-6 whitespace-nowrap">
                        <span className="font-bold text-[#071524] block">{session.dateText}</span>
                        <span className="text-xs text-[#44474C]">
                          {session.timeText} ({session.period})
                        </span>
                      </td>

                      {/* Módulo */}
                      <td className="py-4 px-4">
                        <div className="font-semibold text-[#071524]">{session.moduleName}</div>
                        <span className="text-xs text-[#44474C]">{session.moduleDetail}</span>
                      </td>

                      {/* Duración */}
                      <td className="py-4 px-4 font-semibold text-[#071524] whitespace-nowrap">
                        {session.durationMinutes} min
                        {session.targetDurationMinutes && (
                          <span className="text-xs text-[#44474C] font-normal">
                            {' '}/ {session.targetDurationMinutes}m
                          </span>
                        )}
                      </td>

                      {/* Cumplimiento */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold text-xs ${
                              isInterrupted ? 'text-[#C97E41]' : 'text-[#006A62]'
                            }`}
                          >
                            {session.complianceRate}%
                          </span>
                          <div className="w-20 bg-[#DBF1FE] h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isInterrupted ? 'bg-[#FFB780]' : 'bg-[#006A62]'
                              }`}
                              style={{ width: `${session.complianceRate}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Fijación Foveal */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="font-semibold text-[#071524]">
                          {session.fovealPrecision}% precisión
                        </span>
                        {session.microsaccadesPerSec !== undefined && (
                          <span className="block text-[11px] text-[#44474C]">
                            Microsacadas: {session.microsaccadesPerSec}/s
                          </span>
                        )}
                        {session.latencyMs !== undefined && (
                          <span className="block text-[11px] text-[#44474C]">
                            Latencia: {session.latencyMs}ms
                          </span>
                        )}
                        {isInterrupted && (
                          <span className="block text-[11px] text-[#BA1A1A] font-medium">
                            Desviación en cuadrante
                          </span>
                        )}
                      </td>

                      {/* Validación Técnica */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {isInterrupted ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FFDCC4] text-[#6F3800] text-xs font-semibold border border-[#FFB780]">
                            <AlertTriangle className="w-3.5 h-3.5 text-[#BA1A1A]" />
                            {session.validationLabel}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#81F3E5]/40 text-[#005049] text-xs font-semibold border border-[#006A62]/20">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#006A62]" />
                            {session.validationLabel}
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="py-4 px-4 md:px-6 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => onOpenAnalytics(session)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#071524]/20 hover:bg-[#DBF1FE] text-[#071524] transition-colors cursor-pointer"
                          >
                            Ver Analítica
                          </button>
                          <button
                            onClick={() => onDownloadSessionPDF(session)}
                            className="p-1.5 rounded-lg hover:bg-[#DBF1FE] text-[#071524] transition-colors cursor-pointer"
                            title="Descargar PDF de Sesión"
                          >
                            <FileText className="w-4 h-4 text-[#006A62]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="px-6 py-4 bg-[#E6F6FF]/50 border-t border-[#071524]/10 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-[#44474C]">
            Mostrando{' '}
            <strong className="font-semibold text-[#071524]">
              {filteredSessions.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} -{' '}
              {Math.min(currentPage * pageSize, filteredSessions.length)}
            </strong>{' '}
            de <strong className="font-semibold text-[#071524]">{filteredSessions.length}</strong>{' '}
            sesiones registradas
          </p>

          <div className="inline-flex items-center gap-1 text-xs">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-8 h-8 rounded-lg border border-[#C4C6CC] bg-white text-[#44474C] disabled:opacity-40 transition-colors flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: totalPages }).map((_, i) => {
              const page = i + 1;
              const isActive = page === currentPage;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 rounded-lg font-bold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#071524] text-white'
                      : 'border border-[#C4C6CC]/60 bg-white text-[#071524] hover:bg-[#DBF1FE]'
                  }`}
                >
                  {page}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="w-8 h-8 rounded-lg border border-[#C4C6CC] bg-white text-[#44474C] disabled:opacity-40 transition-colors flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Quick Export Banner */}
      <div className="bg-[#D5ECF8] rounded-xl border border-[#071524]/15 p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#071524] text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-[#84F5E8]" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#071524]">
              Generación de Informe Clínico para Junta Médica o Seguro
            </h3>
            <p className="text-xs text-[#44474C] mt-0.5">
              Firma digital habilitada (Dra. Elena Ramos M. - CMP 48192) con sello de tiempo criptográfico y trazabilidad HL7.
            </p>
          </div>
        </div>

        <button
          onClick={onIssueCertifiedReport}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-[#006A62] hover:bg-[#005049] text-white transition-colors shadow-xs cursor-pointer whitespace-nowrap"
        >
          <Award className="w-4 h-4 text-[#84F5E8]" />
          Emitir Informe Certificado
        </button>
      </div>
    </section>
  );
};
