import type { Patient } from './Patient';
import patientsJson from '../data/patients.json';

export const INITIAL_MOCK_PATIENTS: Patient[] = patientsJson as unknown as Patient[];
