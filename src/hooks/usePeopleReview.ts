import { useState, useRef } from "react";
import { PeopleReviewPerson } from "@/components/PeopleReviewModal";

export function usePeopleReview() {
  const [peopleReviewModalOpen, setPeopleReviewModalOpen] = useState(false);
  const [peopleReviewChatTitle, setPeopleReviewChatTitle] = useState("");
  const [peopleReviewChatId, setPeopleReviewChatId] = useState("");
  const [peopleReviewPeople, setPeopleReviewPeople] = useState<PeopleReviewPerson[]>([]);
  const [peopleReviewFieldDecisions, setPeopleReviewFieldDecisions] = useState<
    Record<
      string,
      {
        fullName: boolean;
        firstName: boolean;
        lastNames: boolean;
        aliases: boolean;
      }
    >
  >({});

  const promptedPeopleReviewRef = useRef<Set<string>>(new Set());

  const updatePersonFieldDecision = (
    fullName: string,
    field: "fullName" | "firstName" | "lastNames" | "aliases",
    value: boolean,
  ) => {
    setPeopleReviewFieldDecisions((current) => {
      const existing = current[fullName] || {
        fullName: true,
        firstName: true,
        lastNames: true,
        aliases: true,
      };
      return {
        ...current,
        [fullName]: { ...existing, [field]: value },
      };
    });
  };

  return {
    peopleReviewModalOpen,
    setPeopleReviewModalOpen,
    peopleReviewChatTitle,
    setPeopleReviewChatTitle,
    peopleReviewChatId,
    setPeopleReviewChatId,
    peopleReviewPeople,
    setPeopleReviewPeople,
    peopleReviewFieldDecisions,
    setPeopleReviewFieldDecisions,
    updatePersonFieldDecision,
    promptedPeopleReviewRef
  }
}
