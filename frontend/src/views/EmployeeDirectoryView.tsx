import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { Employee } from '../types';

interface EmployeeDirectoryViewProps {
  onEditEmployee: (id: number) => void;
  onNewEmployee: () => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const EmployeeDirectoryView: React.FC<EmployeeDirectoryViewProps> = ({
  onEditEmployee,
  onNewEmployee,
  triggerToast
}) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadEmployees();
  }, []);

  async function loadEmployees() {
    try {
      setLoading(true);
      const data = await api.getEmployees();
      setEmployees(data);
      setFilteredEmployees(data);
    } catch (error) {
      console.error('Error fetching employees:', error);
      triggerToast('Failed to load employee list.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let result = employees;

    if (search.trim() !== '') {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.first_name.toLowerCase().includes(q) ||
          e.last_name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          e.role.toLowerCase().includes(q)
      );
    }

    if (department !== '') {
      result = result.filter((e) => e.department.toLowerCase() === department.toLowerCase());
    }

    if (status !== '') {
      result = result.filter((e) => e.status.toLowerCase() === status.toLowerCase());
    }

    setFilteredEmployees(result);
  }, [search, department, status, employees]);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click edit trigger
    if (!window.confirm('Are you sure you want to delete this employee? All YTD ledger history will be lost.')) {
      return;
    }

    try {
      await api.deleteEmployee(id);
      triggerToast('Employee deleted successfully.', 'success');
      loadEmployees();
    } catch (error: any) {
      console.error('Error deleting employee:', error);
      triggerToast(error.message || 'Failed to delete employee.', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200">
            Active
          </span>
        );
      case 'leave':
      case 'on leave':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            On Leave
          </span>
        );
      case 'terminated':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
            Terminated
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-800 border border-gray-200">
            {status}
          </span>
        );
    }
  };

  const formatPayType = (type: string) => {
    switch (type) {
      case 'salary': return 'Salary';
      case 'hourly': return 'Hourly';
      case 'salary_commission': return 'Salary + Commission';
      default: return type;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-highlight"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-on-surface mb-1">Directory</h1>
          <p className="text-sm text-on-surface-variant">Manage your active workforce and payroll status.</p>
        </div>
        <button 
          onClick={onNewEmployee}
          className="bg-highlight hover:bg-opacity-90 text-on-highlight text-sm font-semibold h-10 px-5 rounded-lg shadow-sm transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          New Employee
        </button>
      </div>

      {/* Toolbar / Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm">
        <div className="flex items-center gap-4 flex-1 min-w-[280px]">
          <div className="relative w-full max-w-sm">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">search</span>
            <input 
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees by name, role, email..."
              className="w-full h-10 pl-10 pr-4 rounded-lg border border-outline-variant bg-surface focus:ring-2 focus:ring-highlight focus:border-transparent text-sm text-on-surface transition-shadow outline-none placeholder:text-outline"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select 
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="appearance-none h-10 pl-4 pr-10 rounded-lg border border-outline-variant bg-surface hover:bg-surface-container-low text-xs font-semibold text-on-surface focus:ring-2 focus:ring-highlight focus:border-transparent outline-none cursor-pointer transition-colors"
            >
              <option value="">All Departments</option>
              <option value="engineering">Engineering</option>
              <option value="sales">Sales</option>
              <option value="marketing">Marketing</option>
              <option value="operations">Operations</option>
              <option value="hr">Human Resources</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-lg">expand_more</span>
          </div>
          <div className="relative">
            <select 
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="appearance-none h-10 pl-4 pr-10 rounded-lg border border-outline-variant bg-surface hover:bg-surface-container-low text-xs font-semibold text-on-surface focus:ring-2 focus:ring-highlight focus:border-transparent outline-none cursor-pointer transition-colors"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="leave">On Leave</option>
              <option value="terminated">Terminated</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-lg">expand_more</span>
          </div>
        </div>
      </div>

      {/* Data Table Container */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {filteredEmployees.length === 0 ? (
            <div className="p-12 text-center text-on-surface-variant font-medium">
              No employees match the specified filters.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="text-xs font-bold text-on-surface-variant py-3.5 px-6 uppercase tracking-wider w-1/3">Name</th>
                  <th className="text-xs font-bold text-on-surface-variant py-3.5 px-6 uppercase tracking-wider w-1/4">Role &amp; Department</th>
                  <th className="text-xs font-bold text-on-surface-variant py-3.5 px-6 uppercase tracking-wider w-1/6">Pay Type</th>
                  <th className="text-xs font-bold text-on-surface-variant py-3.5 px-6 uppercase tracking-wider w-1/6">Status</th>
                  <th className="text-xs font-bold text-on-surface-variant py-3.5 px-6 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
				{filteredEmployees.map((emp) => (
                  <tr 
                    key={emp.id} 
                    onClick={() => onEditEmployee(emp.id)}
                    className="border-b border-outline-variant hover:bg-surface-container-low/40 transition-colors group cursor-pointer"
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        {emp.avatar.startsWith('http') ? (
                          <img 
                            src={emp.avatar} 
                            alt={`${emp.first_name} avatar`} 
                            className="w-10 h-10 rounded-full object-cover border border-outline-variant flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold text-sm flex-shrink-0 shadow-sm">
                            {emp.avatar}
                          </div>
                        )}
                        <div>
                          <p className="text-on-surface font-semibold text-sm">{emp.first_name} {emp.last_name}</p>
                          <p className="text-xs text-on-surface-variant font-medium">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <p className="text-on-surface font-medium text-sm">{emp.role}</p>
                      <p className="text-xs text-on-surface-variant font-medium">{emp.department}</p>
                    </td>
                    <td className="py-4 px-6 text-on-surface text-sm font-semibold">
                      {formatPayType(emp.pay_type)}
                    </td>
                    <td className="py-4 px-6">
                      {getStatusBadge(emp.status)}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditEmployee(emp.id);
                          }}
                          className="p-1.5 rounded-lg text-on-surface-variant hover:text-highlight hover:bg-surface-container-high transition-colors"
                          title="Edit Profile"
                        >
                          <span className="material-symbols-outlined text-[20px]">edit</span>
                        </button>
                        <button 
                          onClick={(e) => handleDelete(emp.id, e)}
                          className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/30 transition-colors"
                          title="Delete Employee"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="bg-surface-container-lowest border-t border-outline-variant py-4 px-6 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant font-medium">
            Showing {filteredEmployees.length} of {employees.length} employees
          </p>
        </div>
      </div>
    </div>
  );
};

export default EmployeeDirectoryView;
