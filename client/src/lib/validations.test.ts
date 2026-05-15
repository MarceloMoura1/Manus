import { describe, it, expect } from 'vitest';
import { validations, validateNewChamado } from './validations';

describe('Validations', () => {
  describe('isValidEmail', () => {
    it('should validate correct emails', () => {
      expect(validations.isValidEmail('test@example.com')).toBe(true);
      expect(validations.isValidEmail('user.name@domain.co.uk')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(validations.isValidEmail('invalid.email')).toBe(false);
      expect(validations.isValidEmail('test@')).toBe(false);
      expect(validations.isValidEmail('@example.com')).toBe(false);
    });
  });

  describe('isValidPhone', () => {
    it('should validate correct phone numbers', () => {
      expect(validations.isValidPhone('11 99999-9999')).toBe(true);
      expect(validations.isValidPhone('1199999999')).toBe(true);
      expect(validations.isValidPhone('11 9999-9999')).toBe(true);
    });

    it('should reject invalid phone numbers', () => {
      expect(validations.isValidPhone('123')).toBe(false);
      expect(validations.isValidPhone('abc')).toBe(false);
    });
  });

  describe('isMinLength', () => {
    it('should validate minimum length', () => {
      expect(validations.isMinLength('hello', 5)).toBe(true);
      expect(validations.isMinLength('hello', 4)).toBe(true);
      expect(validations.isMinLength('hello', 6)).toBe(false);
    });
  });

  describe('isMaxLength', () => {
    it('should validate maximum length', () => {
      expect(validations.isMaxLength('hello', 5)).toBe(true);
      expect(validations.isMaxLength('hello', 6)).toBe(true);
      expect(validations.isMaxLength('hello', 4)).toBe(false);
    });
  });

  describe('isNotEmpty', () => {
    it('should validate non-empty strings', () => {
      expect(validations.isNotEmpty('hello')).toBe(true);
      expect(validations.isNotEmpty('  hello  ')).toBe(true);
      expect(validations.isNotEmpty('')).toBe(false);
      expect(validations.isNotEmpty('   ')).toBe(false);
    });
  });

  describe('formatPhone', () => {
    it('should format phone numbers correctly', () => {
      expect(validations.formatPhone('11999999999')).toBe('(11) 99999-9999');
      expect(validations.formatPhone('1133333333')).toBe('(11) 3333-3333');
    });
  });

  describe('removePhoneMask', () => {
    it('should remove phone mask', () => {
      expect(validations.removePhoneMask('(11) 99999-9999')).toBe('11999999999');
      expect(validations.removePhoneMask('11 9999-9999')).toBe('1199999999');
    });
  });

  describe('isValidName', () => {
    it('should validate names with letters only', () => {
      expect(validations.isValidName('João Silva')).toBe(true);
      expect(validations.isValidName('Mary Jane')).toBe(true);
      expect(validations.isValidName('José')).toBe(true);
    });

    it('should reject names with numbers', () => {
      expect(validations.isValidName('João123')).toBe(false);
      expect(validations.isValidName('123')).toBe(false);
    });
  });

  describe('validateNewChamado', () => {
    it('should validate correct chamado data', () => {
      const errors = validateNewChamado({
        customerName: 'João Silva',
        company: 'Empresa XYZ',
        title: 'Problema com login',
        observations: 'Usuário não consegue fazer login',
        priority: 'media',
      });
      expect(errors).toHaveLength(0);
    });

    it('should reject empty customer name', () => {
      const errors = validateNewChamado({
        customerName: '',
        company: 'Empresa XYZ',
        title: 'Problema com login',
      });
      expect(errors.some(e => e.field === 'customerName')).toBe(true);
    });

    it('should reject short customer name', () => {
      const errors = validateNewChamado({
        customerName: 'AB',
        company: 'Empresa XYZ',
        title: 'Problema com login',
      });
      expect(errors.some(e => e.field === 'customerName')).toBe(true);
    });

    it('should reject short title', () => {
      const errors = validateNewChamado({
        customerName: 'João Silva',
        company: 'Empresa XYZ',
        title: 'Prob',
      });
      expect(errors.some(e => e.field === 'title')).toBe(true);
    });

    it('should reject long observations', () => {
      const errors = validateNewChamado({
        customerName: 'João Silva',
        company: 'Empresa XYZ',
        title: 'Problema com login',
        observations: 'a'.repeat(1001),
      });
      expect(errors.some(e => e.field === 'observations')).toBe(true);
    });
  });
});
