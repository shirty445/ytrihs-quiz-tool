"use client";

import { useState } from "react";
import type { QuizPayload, QuizQuestion } from "@/lib/types";

interface QuizEditorProps {
  quiz: QuizPayload;
  onChange: (nextQuiz: QuizPayload) => void;
}

function updateQuestion(
  quiz: QuizPayload,
  questionIndex: number,
  updater: (question: QuizQuestion) => QuizQuestion
): QuizPayload {
  return {
    questions: quiz.questions.map((question, index) =>
      index === questionIndex ? updater(question) : question
    )
  };
}

export function QuizEditor({ quiz, onChange }: QuizEditorProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>Quiz Review And Edit</h2>
          <p className="muted">
            {collapsed
              ? `Collapsed by default. Expand only if you want to manually edit the merged ${quiz.questions.length}-question bank.`
              : "Review every field before exporting. You can edit wording, options, explanation, and source mapping."}
          </p>
        </div>
        <button type="button" className="secondary" onClick={() => setCollapsed((previous) => !previous)}>
          {collapsed ? "Expand Review" : "Collapse Review"}
        </button>
      </div>

      {collapsed ? null : (
        <div className="quiz-cards">
          {quiz.questions.map((question, questionIndex) => (
            <article key={`q-${questionIndex}`} className="quiz-card">
              <h3>Question {questionIndex + 1}</h3>
              <label className="field">
                <span>Question</span>
                <textarea
                  value={question.question}
                  onChange={(event) =>
                    onChange(
                      updateQuestion(quiz, questionIndex, (current) => ({
                        ...current,
                        question: event.target.value
                      }))
                    )
                  }
                  rows={3}
                />
              </label>

              <div className="option-grid">
                {question.options.map((option, optionIndex) => (
                  <label key={`q-${questionIndex}-opt-${optionIndex}`} className="field">
                    <span>Option {String.fromCharCode(65 + optionIndex)}</span>
                    <input
                      type="text"
                      value={option}
                      onChange={(event) =>
                        onChange(
                          updateQuestion(quiz, questionIndex, (current) => {
                            const nextOptions = [...current.options];
                            nextOptions[optionIndex] = event.target.value;
                            return {
                              ...current,
                              options: nextOptions
                            };
                          })
                        )
                      }
                    />
                  </label>
                ))}
              </div>

              <label className="field">
                <span>Correct Answer</span>
                <select
                  value={question.correctAnswer}
                  onChange={(event) =>
                    onChange(
                      updateQuestion(quiz, questionIndex, (current) => ({
                        ...current,
                        correctAnswer: event.target.value
                      }))
                    )
                  }
                >
                  {question.options.map((option, optionIndex) => (
                    <option key={`q-${questionIndex}-correct-${optionIndex}`} value={option}>
                      {String.fromCharCode(65 + optionIndex)}. {option || "(empty)"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Explanation</span>
                <textarea
                  value={question.explanation}
                  onChange={(event) =>
                    onChange(
                      updateQuestion(quiz, questionIndex, (current) => ({
                        ...current,
                        explanation: event.target.value
                      }))
                    )
                  }
                  rows={3}
                />
              </label>

              <div className="source-grid">
                <label className="field">
                  <span>Source File</span>
                  <input
                    type="text"
                    value={question.source.file}
                    onChange={(event) =>
                      onChange(
                        updateQuestion(quiz, questionIndex, (current) => ({
                          ...current,
                          source: {
                            ...current.source,
                            file: event.target.value
                          }
                        }))
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Page</span>
                  <input
                    type="text"
                    value={question.source.page}
                    onChange={(event) =>
                      onChange(
                        updateQuestion(quiz, questionIndex, (current) => ({
                          ...current,
                          source: {
                            ...current.source,
                            page: event.target.value
                          }
                        }))
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Chunk ID</span>
                  <input
                    type="text"
                    value={question.source.chunkId}
                    onChange={(event) =>
                      onChange(
                        updateQuestion(quiz, questionIndex, (current) => ({
                          ...current,
                          source: {
                            ...current.source,
                            chunkId: event.target.value
                          }
                        }))
                      )
                    }
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
