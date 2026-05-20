/**
 * Funções de validação para formulários
 */

export const validations = {
  /**
   * Valida email
   */
  isValidEmail: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  /**
   * Valida telefone (formato brasileiro)
   */
  isValidPhone: (phone: string): boolean => {
    const phoneRegex = /^(\d{2})?\s?9?\d{4}-?\d{4}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  },

  /**
   * Valida comprimento mínimo
   */
  isMinLength: (text: string, min: number): boolean => {
    return text.trim().length >= min;
  },

  /**
   * Valida comprimento máximo
   */
  isMaxLength: (text: string, max: number): boolean => {
    return text.length <= max;
  },

  /**
   * Valida se não está vazio
   */
  isNotEmpty: (text: string): boolean => {
    return text.trim().length > 0;
  },

  /**
   * Formata telefone com máscara
   */
  formatPhone: (phone: string): string => {
    let cleaned = phone.replace(/\D/g, '');
    // Remover prefixo internacional 55 (Brasil) se presente
    if (cleaned.length === 13 && cleaned.startsWith('55')) {
      cleaned = cleaned.slice(2); // 55 + 11 dígitos
    } else if (cleaned.length === 12 && cleaned.startsWith('55')) {
      cleaned = cleaned.slice(2); // 55 + 10 dígitos
    }
    if (cleaned.length === 11) {
      return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    }
    if (cleaned.length === 10) {
      return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    }
    return phone;
  },

  /**
   * Remove máscara de telefone
   */
  removePhoneMask: (phone: string): string => {
    return phone.replace(/\D/g, '');
  },

  /**
   * Valida nome (sem números no início)
   */
  isValidName: (name: string): boolean => {
    return /^[a-zA-ZÀ-ÿ\s]+$/.test(name.trim());
  },
};

export type ValidationError = {
  field: string;
  message: string;
};

/**
 * Valida formulário de novo chamado
 */
export function validateNewChamado(data: {
  customerName: string;
  company: string;
  title: string;
  observations?: string;
  priority?: string;
}): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!validations.isNotEmpty(data.customerName)) {
    errors.push({ field: 'customerName', message: 'Nome do cliente é obrigatório' });
  } else if (!validations.isValidName(data.customerName)) {
    errors.push({ field: 'customerName', message: 'Nome deve conter apenas letras' });
  } else if (!validations.isMinLength(data.customerName, 3)) {
    errors.push({ field: 'customerName', message: 'Nome deve ter no mínimo 3 caracteres' });
  } else if (!validations.isMaxLength(data.customerName, 100)) {
    errors.push({ field: 'customerName', message: 'Nome não pode ter mais de 100 caracteres' });
  }

  if (!validations.isNotEmpty(data.company)) {
    errors.push({ field: 'company', message: 'Empresa é obrigatória' });
  } else if (!validations.isMinLength(data.company, 2)) {
    errors.push({ field: 'company', message: 'Empresa deve ter no mínimo 2 caracteres' });
  } else if (!validations.isMaxLength(data.company, 100)) {
    errors.push({ field: 'company', message: 'Empresa não pode ter mais de 100 caracteres' });
  }

  if (!validations.isNotEmpty(data.title)) {
    errors.push({ field: 'title', message: 'Título é obrigatório' });
  } else if (!validations.isMinLength(data.title, 5)) {
    errors.push({ field: 'title', message: 'Título deve ter no mínimo 5 caracteres' });
  } else if (!validations.isMaxLength(data.title, 200)) {
    errors.push({ field: 'title', message: 'Título não pode ter mais de 200 caracteres' });
  }

  if (data.observations && !validations.isMaxLength(data.observations, 1000)) {
    errors.push({ field: 'observations', message: 'Observações não podem ter mais de 1000 caracteres' });
  }

  return errors;
}
