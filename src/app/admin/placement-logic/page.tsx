"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, Plus, Edit2, Trash2, ShieldAlert } from "lucide-react";

export default function AdminPlacementLogicPage() {
  const [limits, setLimits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ budget_threshold: "", daily_placement_limit: "" });
  const [submitting, setSubmitting] = useState(false);

  // Delete Confirm Modal
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const fetchLimits = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/placement-logic");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLimits(data.limits || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch placement logic");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLimits();
  }, []);

  const openAddModal = () => {
    setFormData({ budget_threshold: "", daily_placement_limit: "" });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (limit: any) => {
    setFormData({ budget_threshold: limit.budget_threshold.toString(), daily_placement_limit: limit.daily_placement_limit.toString() });
    setEditingId(limit.id);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const method = editingId ? "PUT" : "POST";
      const body = editingId ? { 
        id: editingId, 
        budget_threshold: parseFloat(formData.budget_threshold),
        daily_placement_limit: parseInt(formData.daily_placement_limit)
      } : {
        budget_threshold: parseFloat(formData.budget_threshold),
        daily_placement_limit: parseInt(formData.daily_placement_limit)
      };

      const res = await fetch("/api/admin/placement-logic", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save rule");

      setIsModalOpen(false);
      fetchLimits();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/placement-logic", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteConfirmId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete rule");

      setDeleteConfirmId(null);
      fetchLimits();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout>
      {/* Error Modal */}
      {error && (
        <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-lg w-full max-w-md shadow-2xl border border-red-200 overflow-hidden">
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-center gap-3">
              <ShieldAlert className="text-red-600" size={24} />
              <h3 className="font-bold text-red-900 text-lg">Error</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-700 text-sm leading-relaxed mb-6">{error}</p>
              <div className="flex justify-end">
                <button 
                  onClick={() => setError("")}
                  className="px-5 py-2 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Delete Rule</h3>
            <p className="text-sm text-slate-600 mb-6">Are you sure you want to delete this placement rule? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2 text-slate-600 border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleDelete}
                disabled={submitting}
                className="flex-1 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-sm shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">{editingId ? "Edit Rule" : "Add Rule"}</h3>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Budget Threshold ($)</label>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  value={formData.budget_threshold}
                  onChange={(e) => setFormData({ ...formData, budget_threshold: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="e.g. 100"
                />
                <p className="text-xs text-slate-500 mt-1">If campaign budget is under this amount</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Daily Placement Limit</label>
                <input 
                  type="number" 
                  required
                  value={formData.daily_placement_limit}
                  onChange={(e) => setFormData({ ...formData, daily_placement_limit: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="e.g. 5"
                />
                <p className="text-xs text-slate-500 mt-1">Max channel posts per 24 hours</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 text-slate-600 border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Rule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Placement Logic Rules</h2>
          <button 
            onClick={openAddModal}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 transition-colors cursor-pointer"
          >
            <Plus size={14} /> Add Rule
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap min-w-[600px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">Budget Threshold</th>
                <th className="px-4 py-3 font-medium">Daily Limit</th>
                <th className="px-4 py-3 font-medium">Logic Description</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="p-8 text-center"><Loader2 className="animate-spin text-blue-600 mx-auto" size={24} /></td></tr>
              ) : limits.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-slate-500">No placement rules found.</td></tr>
              ) : (
                limits.map((limit: any, index: number) => {
                  const threshold = parseFloat(limit.budget_threshold);
                  const prevThreshold = index > 0 ? parseFloat(limits[index-1].budget_threshold) : 0;
                  
                  return (
                  <tr key={limit.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      Under ${threshold.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-xs font-bold">
                        {limit.daily_placement_limit} posts
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-normal">
                      If budget is {index > 0 ? `between $${prevThreshold.toFixed(2)} and $${threshold.toFixed(2)}` : `under $${threshold.toFixed(2)}`}, then campaign will be posted to {limit.daily_placement_limit} channels per 24 hours until its budget is over or paused.
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => openEditModal(limit)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => setDeleteConfirmId(limit.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
