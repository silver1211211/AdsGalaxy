"use client";
import React, { useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import AiSupportPanel from "@/components/shared/AiSupportPanel";
import { useHeader } from "@/context/HeaderContext";
import { useTranslations } from "@/i18n/client";
export default function AdvertiserAiSupportPage(){const{setTitle}=useHeader(),{t}=useTranslations();useEffect(()=>setTitle(t("aiSupport.title")),[setTitle,t]);return <DashboardLayout type="advertiser"><AiSupportPanel/></DashboardLayout>}
